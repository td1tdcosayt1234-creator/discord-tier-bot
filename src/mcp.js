// Minimal MCP (Model Context Protocol) HTTP client.
// Supports streamable-HTTP servers: baseUrl + optional headers + optional auth.
// Stored per-guild via !mcp / /mcp panel.

export function normalizeMcpUrl(raw) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return s;
  } catch {
    return null;
  }
}

export function validMcpName(name) {
  return /^[a-z0-9][a-z0-9-_]{0,31}$/i.test(String(name || '').trim());
}

// headers input: JSON object OR "Key: Value" lines. Returns { ok, headers?, error? }
export function parseHeaders(input) {
  const s = String(input || '').trim();
  if (!s) return { ok: true, headers: {} };
  try {
    if (s.startsWith('{')) {
      const o = JSON.parse(s);
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('bad json');
      const out = {};
      for (const [k, v] of Object.entries(o)) {
        if (!k.trim() || /[\r\n]/.test(k)) throw new Error('bad key');
        out[k.trim()] = String(v);
      }
      return { ok: true, headers: out };
    }
    const out = {};
    for (const line of s.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const i = t.indexOf(':');
      if (i < 1) throw new Error(`bad line: ${t}`);
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return { ok: true, headers: out };
  } catch {
    return { ok: false, error: 'Bad headers format! Use JSON `{"X-Key":"v"}` or `X-Key: v` lines.' };
  }
}

// auth can be a plain token OR JSON {access_token, refresh_token, expires_at}
export function parseAuth(auth) {
  const s = String(auth || '').trim();
  if (!s) return { access: null, refresh: null, expiresAt: 0 };
  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s);
      return { access: o.access_token || null, refresh: o.refresh_token || null, expiresAt: Number(o.expires_at) || 0 };
    } catch { /* fall through */ }
  }
  return { access: s, refresh: null, expiresAt: 0 };
}

export function buildHeaders(headersJson, auth) {
  const p = parseHeaders(headersJson);
  if (!p.ok) return p;
  const h = { ...p.headers };
  const a = parseAuth(auth).access;
  if (a && !h.Authorization && !h.authorization) h.Authorization = /^bearer\s/i.test(a) ? a : `Bearer ${a}`;
  return { ok: true, headers: h };
}

async function rpc(baseUrl, headers, method, params) {
  const { isPublicHttpUrl, SSRF_ERROR } = await import('./util.js');
  if (!(await isPublicHttpUrl(baseUrl))) return { ok: false, error: SSRF_ERROR };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    // 1) initialize
    let sessionId = null;
    const initRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'discord-tier-bot', version: '1.0.0' }, ...(params?._init || {}) } }),
      signal: controller.signal,
    });
    sessionId = initRes.headers.get('mcp-session-id') || initRes.headers.get('Mcp-Session-Id');
    const initText = await initRes.text().catch(() => '');
    if (!initRes.ok) return { ok: false, error: `HTTP ${initRes.status}: ${initText.slice(0, 200)}` };
    const extra = sessionId ? { 'Mcp-Session-Id': sessionId } : {};

    const call = async (id, m, p) => {
      const r = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers, ...extra },
        body: JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p || {} }),
        signal: controller.signal,
      });
      const t = await r.text().catch(() => '');
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
      // SSE or JSON — pull first JSON-RPC object
      let data = null;
      for (const line of t.split('\n')) {
        const s = line.replace(/^data:\s*/, '').trim();
        if (!s || s === '[DONE]') continue;
        try {
          const o = JSON.parse(s.startsWith('{') ? s : s);
          if (o?.result !== undefined || o?.error) { data = o; break; }
        } catch { /* not json line */ }
      }
      if (!data) {
        try { data = JSON.parse(t); } catch { return { ok: false, error: `Unparsable response: ${t.slice(0, 200)}` }; }
      }
      if (data.error) return { ok: false, error: data.error.message || JSON.stringify(data.error).slice(0, 200) };
      return { ok: true, result: data.result };
    };

    if (method === '__init__') return { ok: true, result: { sessionId: !!sessionId, info: initText.slice(0, 200) } };
    return call(2, method, params);
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'Timed out!' : (e?.message || 'Failed') };
  } finally {
    clearTimeout(timeout);
  }
}

export async function testMcpServer(baseUrl, headersJson, auth) {
  const base = normalizeMcpUrl(baseUrl);
  if (!base) return { ok: false, error: 'Invalid base URL! Use `https://...`.' };
  const { isPublicHttpUrl, SSRF_ERROR } = await import('./util.js');
  if (!(await isPublicHttpUrl(base))) return { ok: false, error: SSRF_ERROR };
  const b = buildHeaders(headersJson, auth);
  if (!b.ok) return b;
  // reachability first
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 10000);
    const r = await fetch(base, { method: 'GET', headers: b.headers, signal: c.signal }).catch(() => null);
    clearTimeout(t);
    void r;
  } catch { /* some MCP servers reject GET — ignore */ }
  return rpc(base, b.headers, '__init__');
}

export async function listMcpTools(server) {
  const rs = await resolveServer(server);
  if (!rs.ok) return rs;
  const b = buildHeaders(rs.server.headers, rs.server.auth);
  if (!b.ok) return b;
  const r = await rpc(rs.server.base_url, b.headers, 'tools/list');
  if (!r.ok) return r;
  const tools = r.result?.tools || [];
  return { ok: true, tools: tools.map(t => ({ name: t.name, description: (t.description || '').slice(0, 200) })) };
}

export async function callMcpTool(server, toolName, args) {
  const rs = await resolveServer(server);
  if (!rs.ok) return rs;
  const b = buildHeaders(rs.server.headers, rs.server.auth);
  if (!b.ok) return b;
  let a = {};
  if (typeof args === 'string' && args.trim()) {
    try { a = JSON.parse(args); } catch { return { ok: false, error: 'Invalid args JSON!' }; }
  } else if (args && typeof args === 'object') a = args;
  const r = await rpc(rs.server.base_url, b.headers, 'tools/call', { name: toolName, arguments: a });
  if (!r.ok) return r;
  const c = r.result?.content;
  const text = Array.isArray(c) ? c.map(x => x.text || JSON.stringify(x)).join('\n').slice(0, 1800) : JSON.stringify(r.result).slice(0, 1800);
  return { ok: true, text: text || '(empty result)' };
}

export function maskAuth(auth) {
  const s = parseAuth(auth).access || '';
  if (!s) return null;
  return s.length <= 8 ? '****' : `****${s.slice(-4)}`;
}

// For OAuth servers, refresh the token first and return a fresh server object
async function resolveServer(server) {
  if (!server?.token_url || !server?.guild_id || !server?.name) return { ok: true, server };
  const { getValidAccessToken } = await import('./mcpAuth.js');
  const r = await getValidAccessToken(server.guild_id, server.name);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, server: { ...r.server, auth: r.access } };
}
