// MCP OAuth login (Notion-style): log in via browser, no token paste needed.
// Flow: /mcp login <name> -> discovery (RFC 9470/8414) -> dynamic client
// registration (RFC 7591, Notion supports it) -> authorize URL -> user logs in
// on provider -> /api/mcp-callback?code&state -> token saved, auto-refresh.
import { randomBytes, createHash } from 'node:crypto';
import { getMcpServer, saveMcpOAuth, getMcpOAuth, clearMcpOAuth, setMcpOAuthCreds } from './db.js';

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function getJson(url, timeoutMs = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: c.signal });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Discover OAuth endpoints: RFC 9470 protected-resource metadata -> RFC 8414.
// Tries path-inserted + origin-root candidates (Notion uses path form).
export async function discoverOAuth(baseUrl) {
  const { isPublicHttpUrl } = await import('./util.js');
  if (!(await isPublicHttpUrl(baseUrl))) {
    const { SSRF_ERROR } = await import('./util.js');
    return { ok: false, error: SSRF_ERROR };
  }
  let u;
  try { u = new URL(baseUrl); } catch { return { ok: false, error: 'Invalid base URL!' }; }
  const origin = u.origin;
  const path = u.pathname.replace(/\/+$/, '');
  const cands = [
    `${origin}/.well-known/oauth-protected-resource${path}`,
    `${origin}/.well-known/oauth-protected-resource`,
    `${baseUrl.replace(/\/+$/, '')}/.well-known/oauth-protected-resource`,
  ];
  let issuers = [];
  for (const c of cands) {
    if (!(await isPublicHttpUrl(c))) continue;
    const prm = await getJson(c);
    if (prm?.authorization_servers?.length) {
      // only accept public https issuers
      issuers = prm.authorization_servers.filter(s => typeof s === 'string' && /^https:\/\//i.test(s));
      if (issuers.length) break;
    }
  }
  const servers = issuers.length ? issuers : [origin];
  for (const iss of servers) {
    if (!(await isPublicHttpUrl(iss))) continue;
    const md = await getJson(`${String(iss).replace(/\/+$/, '')}/.well-known/oauth-authorization-server`);
    if (md?.authorization_endpoint && md?.token_endpoint) {
      if (!(await isPublicHttpUrl(md.authorization_endpoint)) || !(await isPublicHttpUrl(md.token_endpoint))) continue;
      if (md.registration_endpoint && !(await isPublicHttpUrl(md.registration_endpoint))) {
        // skip insecure registration, keep endpoints but no dynamic registration
        return {
          ok: true,
          authorizationEndpoint: md.authorization_endpoint,
          tokenEndpoint: md.token_endpoint,
          registrationEndpoint: null,
          scopes: md.scopes_supported || [],
        };
      }
      return {
        ok: true,
        authorizationEndpoint: md.authorization_endpoint,
        tokenEndpoint: md.token_endpoint,
        registrationEndpoint: md.registration_endpoint || null,
        scopes: md.scopes_supported || [],
      };
    }
  }
  return { ok: false, error: 'This server does not support OAuth discovery! If you have a token, save it with ➕ Add + auth.' };
}

function publicBase() {
  const port = process.env.PORT || 3000;
  return (process.env.DASHBOARD_URL || `http://localhost:${port}`).replace(/\/+$/, '');
}

async function registerClient(regUrl, redirectUri) {
  const { isPublicHttpUrl, SSRF_ERROR } = await import('./util.js');
  if (!(await isPublicHttpUrl(regUrl))) return { ok: false, error: SSRF_ERROR };
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(regUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'DiscordTierBot', redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
      signal: c.signal,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.client_id) return { ok: false, error: data?.error_description || `Registration fail (${r.status})` };
    return { ok: true, clientId: data.client_id, clientSecret: data.client_secret || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed' };
  } finally {
    clearTimeout(t);
  }
}

export async function startMcpLogin(guildId, serverName) {
  const s = getMcpServer(guildId, serverName);
  if (!s) return { ok: false, error: 'Server not found! First save the baseUrl with ➕ Add (auth can stay empty).' };
  const d = await discoverOAuth(s.base_url);
  if (!d.ok) return d;
  // Dynamic client registration (Notion supports RFC 7591) — no manual client_id needed
  let clientId = publicBase(), clientSecret = null;
  if (d.registrationEndpoint) {
    const reg = await registerClient(d.registrationEndpoint, publicBase() + '/api/mcp-callback');
    if (!reg.ok) return { ok: false, error: `Client registration fail: ${reg.error}` };
    clientId = reg.clientId; clientSecret = reg.clientSecret;
  }
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  saveMcpOAuth(state, guildId, s.name, verifier, d.tokenEndpoint, clientId, clientSecret);
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId,
    redirect_uri: publicBase() + '/api/mcp-callback',
    resource: s.base_url, state,
    code_challenge: challenge, code_challenge_method: 'S256', prompt: 'consent',
  });
  if (d.scopes.length) q.set('scope', d.scopes.join(' '));
  return { ok: true, url: `${d.authorizationEndpoint}?${q.toString()}` };
}

export async function finishMcpLogin(code, state) {
  const p = getMcpOAuth(state);
  if (!p) return { ok: false, error: 'State expired/invalid! Run /mcp login again in Discord (valid 10 min).' };
  const { isPublicHttpUrl, SSRF_ERROR } = await import('./util.js');
  if (!(await isPublicHttpUrl(p.token_url))) return { ok: false, error: SSRF_ERROR };
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code,
      redirect_uri: publicBase() + '/api/mcp-callback',
      code_verifier: p.verifier, client_id: p.client_id,
    });
    if (p.client_secret) body.append('client_secret', p.client_secret);
    const r = await fetch(p.token_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(), signal: c.signal,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.access_token) {
      return { ok: false, error: data?.error_description || data?.error || `Token exchange fail (${r.status})` };
    }
    const s = getMcpServer(p.guild_id, p.server_name);
    setMcpOAuthCreds(p.guild_id, p.server_name, {
      tokenUrl: p.token_url, clientId: p.client_id, clientSecret: p.client_secret,
      accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in,
    });
    void s;
    clearMcpOAuth(state);
    return { ok: true, server: p.server_name };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed' };
  } finally {
    clearTimeout(t);
  }
}

// Fresh access token (auto-refresh if expired). Returns { ok, access?, error? }
export async function getValidAccessToken(guildId, serverName) {
  const { parseAuth } = await import('./mcp.js');
  const { isPublicHttpUrl, SSRF_ERROR } = await import('./util.js');
  const s = getMcpServer(guildId, serverName);
  if (!s?.auth) return { ok: false, error: 'No auth saved! Run /mcp login.' };
  const a = parseAuth(s.auth);
  if (a.access && (!a.expiresAt || a.expiresAt > Date.now() + 5 * 60 * 1000)) {
    return { ok: true, access: a.access, server: s };
  }
  if (!a.refresh || !s.token_url || !s.client_id) {
    return { ok: false, error: 'Token expired! Run /mcp login again.', reauth: true };
  }
  if (!(await isPublicHttpUrl(s.token_url))) return { ok: false, error: SSRF_ERROR };
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: a.refresh, client_id: s.client_id });
    if (s.client_secret) body.append('client_secret', s.client_secret);
    const r = await fetch(s.token_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(), signal: c.signal,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.access_token) {
      if (data?.error === 'invalid_grant') return { ok: false, error: 'Session dead! Run /mcp login again.', reauth: true };
      return { ok: false, error: `Refresh failed (${r.status})! Run /mcp login again.`, reauth: true };
    }
    setMcpOAuthCreds(guildId, s.name, {
      tokenUrl: s.token_url, clientId: s.client_id, clientSecret: s.client_secret,
      accessToken: data.access_token, refreshToken: data.refresh_token || a.refresh, expiresIn: data.expires_in,
    });
    return { ok: true, access: data.access_token, server: { ...s, auth: data.access_token } };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed' };
  } finally {
    clearTimeout(t);
  }
}
