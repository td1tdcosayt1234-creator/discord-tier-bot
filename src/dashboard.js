import express from 'express';
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  getTierName, getTierRows, getPlayers,
  createTier, deleteTier, addPlayer, removePlayer, setTierEmoji,
  getAIConfig, getAIConfigFull, setAICustom, clearAIConfig, isValidGuildId,
  createJoinCode, listJoinCodes, revokeJoinCode, listMcpServers,
  getOrCreatePersonalJoinCode, getPersonalJoinCode,
  getCodingPref, setCodingMode,
  trackEvent, queryEvents, eventStats,
} from './db.js';
import { askAI, askCustomAI, validateCustomInput, validateProviderInput, maskKey, AI_PROVIDERS } from './ai.js';
import { authEnabled, checkLogin, signSession, signGoogleSession, signDiscordSession, signMemberSession, discordConfigured, sessionUser, sessionRole, isAdmin, sessionDiscordId, requireLoginPage, requireLoginApi, requireAdminPage, requireAdminApi, sessionCookie, clearCookie, loginRateLimited, recordLoginFail, isIpBlocked, isUserBlocked, listBlocks, unblockIp, unblockUser, clearAllBlocks } from './auth.js';
import { workspaceFiles, workspaceFileInfo, workspaceDeleteFile } from './agent.js';
import { finishMcpLogin } from './mcpAuth.js';
import { finishGoogleLogin, startDashboardGoogleLogin, finishDashboardGoogleLogin } from './oauth.js';
import { hasBadMentions } from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function checkGuild(guild) {
  return typeof guild === 'string' && isValidGuildId(guild);
}

// tiny rate limit for public /api/ai: 15 req/min per IP
const aiHits = new Map();
function aiRateLimited(ip) {
  const now = Date.now();
  const arr = (aiHits.get(ip) || []).filter(t => now - t < 60_000);
  arr.push(now);
  aiHits.set(ip, arr);
  return arr.length > 15;
}

export function startDashboard(client) {
  const app = express();
  app.disable('x-powered-by');
  // Behind Cloudflare Quick Tunnel the real client IP arrives via CF-Connecting-IP.
  app.set('trust proxy', 1);
  const PORT = process.env.PORT || 3000;
  const KEY = process.env.DASHBOARD_KEY;

  const getIp = req => {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (cf && /^[0-9a-fA-F:., ]+$/.test(cf)) return cf.split(',')[0].trim();
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff && /^[0-9a-fA-F:., ]+$/.test(xff)) return xff;
    return req.ip;
  };
  const isSecure = req => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const secureCookie = (req, token) => sessionCookie(token, isSecure(req));

  // Security headers (pages use inline scripts/styles, so script/style stay 'unsafe-inline')
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '));
    if (isSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // Global /api throttle: 150 req/min per IP (dashboards poll lightly)
  const throttle = new Map();
  app.use('/api/', (req, res, next) => {
    const ip = getIp(req);
    const now = Date.now();
    const e = throttle.get(ip) || { n: 0, reset: now + 60000 };
    if (now > e.reset) { e.n = 0; e.reset = now + 60000; }
    e.n++;
    throttle.set(ip, e);
    if (e.n > 150) {
      trackEvent({ type: 'security', user: null, ip, action: 'throttle-hit', detail: `${req.method} ${req.path}` });
      return res.status(429).json({ error: 'Too many requests, slow down!' });
    }
    next();
  });

  const auditType = action => {
    const a = String(action || '');
    if (/^login|^google-login|^discord-login/.test(a)) return 'login';
    if (/^my-ai$|^ai$/.test(a)) return 'ai';
    if (/^tier|^player|^emoji/.test(a)) return 'tier';
    if (/^code|^join|^my-code/.test(a)) return 'code';
    if (/^mcp/.test(a)) return 'mcp';
    if (/^coding/.test(a)) return 'coding';
    if (/^file/.test(a)) return 'file';
    if (/^throttle|^block|^unblock/.test(a)) return 'security';
    return 'audit';
  };

  // Audit log: who did what (no passwords/keys/tokens ever logged) — file + DB.
  const audit = (req, action, detail) => {
    const user = (() => { try { return sessionUser(req) || 'anon'; } catch { return 'anon'; } })();
    const ip = (() => { try { return getIp(req); } catch { return null; } })();
    const guild = (() => {
      try {
        const g = req.body?.guild || req.query?.guild;
        return typeof g === 'string' && isValidGuildId(g) ? g : null;
      } catch { return null; }
    })();
    const line = `${new Date().toISOString()} ip=${ip} user=${user} action=${action}${detail ? ' ' + String(detail).slice(0, 200) : ''}\n`;
    console.log('[audit]', line.trim());
    try { appendFileSync(join(__dirname, '..', 'audit.log'), line); }
    catch { /* ignore */ }
    try { trackEvent({ type: auditType(action), user, guildId: guild, ip, action, detail }); }
    catch { /* ignore */ }
  };

  app.use(express.json({ limit: '100kb' }));
  // Malformed JSON -> clean 400 (never an HTML stack trace).
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed' || err?.status === 400) {
      return res.status(400).json({ error: 'Bad JSON body!' });
    }
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      try { trackEvent({ type: 'security', ip: getIp(req), action: 'oversize-body', detail: `${req.method} ${req.path}` }); } catch { /* ignore */ }
      return res.status(413).json({ error: 'Body too large (max 100KB)!' });
    }
    next(err);
  });

  // CSRF: browser cross-site POSTs blocked (same-origin Origin required when present,
  // else same-host Referer when present). API clients without either header (curl) still work.
  app.use((req, res, next) => {
    if (!['POST', 'DELETE', 'PUT', 'PATCH'].includes(req.method)) return next();
    const sameHost = h => {
      try { return new URL(h).host === req.headers.host; }
      catch { return false; }
    };
    const o = req.headers.origin;
    if (o) {
      if (!sameHost(o)) {
        audit(req, 'csrf-block', `origin=${String(o).slice(0, 80)}`);
        return res.status(403).json({ error: 'Cross-site requests blocked' });
      }
      return next();
    }
    const ref = req.headers.referer || req.headers.referrer;
    if (ref && !sameHost(ref)) {
      audit(req, 'csrf-block', `referer=${String(ref).slice(0, 80)}`);
      return res.status(403).json({ error: 'Cross-site requests blocked' });
    }
    next();
  });
  app.use(express.static(join(__dirname, 'public')));

  if (authEnabled()) console.log('[dashboard] login required (ADMIN_USER set)');
  else console.log('[dashboard] public mode — set ADMIN_USER/ADMIN_PASS in .env to require login');
  if (String(process.env.ADMIN_USER || '') === 'admin' && String(process.env.ADMIN_PASS || '') === 'change_this_password') {
    console.warn('[security] WARNING: default ADMIN_USER/ADMIN_PASS in use — change them immediately!');
  }
  if (!process.env.SESSION_SECRET) {
    console.warn('[security] WARNING: SESSION_SECRET not set — sessions fall back to DASHBOARD_KEY/ADMIN_PASS. Set a long random SESSION_SECRET!');
  }

  // Login (public)
  app.get('/login', (req, res) => {
    if (authEnabled() && sessionUser(req)) return res.redirect('/');
    if (!authEnabled()) return res.redirect('/');
    res.sendFile(join(__dirname, 'views', 'login.html'));
  });

  app.post('/api/login', (req, res) => {
    if (!authEnabled()) return res.status(400).json({ error: 'Login not configured (set ADMIN_USER/ADMIN_PASS)' });
    const ip = getIp(req);
    if (loginRateLimited(ip)) {
      audit(req, 'login-blocked', 'rate-limited');
      return res.status(429).json({ error: 'Too many tries! Wait 5 minutes.' });
    }
    if (isIpBlocked(ip)) {
      audit(req, 'login-blocked', 'ip-blocked');
      return res.status(429).json({ error: 'Blocked for 30 minutes due to repeated failures!' });
    }
    const { user, pass } = req.body || {};
    if (typeof user !== 'string' || typeof pass !== 'string' || !user || !pass || user.length > 100 || pass.length > 200) {
      return res.status(400).json({ error: 'Missing user/pass' });
    }
    if (isUserBlocked(String(user))) {
      audit(req, 'login-blocked', `user=${String(user).slice(0, 32)}`);
      return res.status(429).json({ error: 'Too many tries for this account! Wait 15 minutes.' });
    }
    if (!checkLogin(String(user), String(pass))) {
      recordLoginFail(ip, String(user));
      audit(req, 'login-fail', `user=${String(user).slice(0, 32)}`);
      return res.status(401).json({ error: 'Wrong username/password!' });
    }
    res.setHeader('Set-Cookie', secureCookie(req, signSession(String(user))));
    audit(req, 'login-ok');
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    audit(req, 'logout');
    res.setHeader('Set-Cookie', clearCookie());
    res.json({ ok: true });
  });

  // ---- Login with Discord (OAuth2). Admins: bot-guild owners/admins or ADMIN_DISCORD_IDS.
  // Everyone else logs in as a member and can claim 1 personal /join code at /my-code.
  const discordStates = new Map();
  const discordRedirect = () => `${(process.env.DASHBOARD_URL || `http://localhost:${PORT}`).replace(/\/+$/, '')}/api/discord-callback`;

  app.get('/api/discord-login', (req, res) => {
    if (!discordConfigured()) return res.status(400).send('<h2>❌ Discord login not configured! Owner: set DISCORD_CLIENT_ID/SECRET in .env.</h2>');
    const state = randomBytes(16).toString('hex');
    discordStates.set(state, Date.now());
    const q = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID.trim(),
      redirect_uri: discordRedirect(),
      response_type: 'code', scope: 'identify guilds', state,
      prompt: 'consent',
    });
    res.redirect(`https://discord.com/oauth2/authorize?${q.toString()}`);
  });

  app.get('/api/discord-callback', async (req, res) => {
    const { code, state, error, error_description } = req.query || {};
    if (error) return res.status(400).send(`<h2>❌ Discord login failed: ${String(error_description || error).slice(0, 200)}</h2>`);
    const at = discordStates.get(state);
    discordStates.delete(state);
    if (!code || !at || Date.now() - at > 10 * 60 * 1000) {
      return res.status(400).send('<h2>❌ Invalid/expired login! Go back and try again.</h2>');
    }
    try {
      const t = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID.trim(),
          client_secret: process.env.DISCORD_CLIENT_SECRET.trim(),
          grant_type: 'authorization_code', code: String(code),
          redirect_uri: discordRedirect(),
        }).toString(),
      });
      const tok = await t.json().catch(() => null);
      if (!t.ok || !tok?.access_token) return res.status(400).send('<h2>❌ Token exchange failed! Try again.</h2>');
      const me = await (await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json().catch(() => null);
      if (!me?.id) return res.status(400).send('<h2>❌ Could not read Discord profile!</h2>');
      const allow = String(process.env.ADMIN_DISCORD_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      let ok = allow.includes(me.id);
      let why = 'allowlist';
      if (!ok) {
        const gs = await (await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json().catch(() => []);
        for (const g of Array.isArray(gs) ? gs : []) {
          if (!client.guilds.cache.get(g.id)) continue;
          if (g.owner) { ok = true; why = 'server owner'; break; }
          try {
            const p = BigInt(g.permissions);
            if ((p & 0x8n) || (p & 0x20n)) { ok = true; why = 'server admin'; break; }
          } catch { /* ignore */ }
        }
      }
      void why;
      if (!ok) {
        res.setHeader('Set-Cookie', secureCookie(req, signMemberSession(me.id, me.username || me.id)));
        audit(req, 'discord-login-member', `discord=${me.id}`);
        return res.redirect('/user');
      }
      res.setHeader('Set-Cookie', secureCookie(req, signDiscordSession(me.id, me.username || me.id)));
      audit(req, 'discord-login-ok', `discord=${me.id}`);
      res.redirect('/');
    } catch (e) {
      res.status(500).send(`<h2>❌ Login error: ${String(e?.message || e).slice(0, 200)}</h2>`);
    }
  });

  // AI OAuth callback (Google login; public — state verified, single use, 10 min)
  app.get('/api/oauth-callback', async (req, res) => {
    const { code, state, error, error_description } = req.query || {};
    if (error) return res.status(400).send(`<h2>❌ Google login failed: ${String(error_description || error).slice(0, 200)}</h2><p>Go back to Discord and run <code>!!connect login google</code> again.</p>`);
    if (!code || !state) return res.status(400).send('<h2>❌ Missing code/state!</h2>');
    const r = await finishGoogleLogin(String(code), String(state));
    if (!r.ok) return res.status(400).send(`<h2>❌ ${r.error}</h2><p>Go back to Discord and run <code>!!connect login google</code> again.</p>`);
    res.send(`<h2>✅ Connected with Google!</h2><p>Model: <code>${r.model}</code>. Close this tab and use <code>!ai</code> in Discord.</p>`);
  });

  // Google web login (Continue with Google; public — state verified, email allowlisted)
  app.get('/api/google-login', (req, res) => {
    const r = startDashboardGoogleLogin();
    if (!r.ok) return res.status(400).send(`<h2>❌ ${r.error}</h2>`);
    res.redirect(r.url);
  });

  app.get('/api/google-callback', async (req, res) => {
    const { code, state, error, error_description } = req.query || {};
    if (error) return res.status(400).send(`<h2>❌ Google login failed: ${String(error_description || error).slice(0, 200)}</h2>`);
    if (!code || !state) return res.status(400).send('<h2>❌ Missing code/state!</h2>');
    const r = await finishDashboardGoogleLogin(String(code), String(state));
    if (!r.ok) return res.status(403).send(`<h2>❌ ${r.error}</h2><p><a href="/login">Back to login</a></p>`);
    res.setHeader('Set-Cookie', secureCookie(req, signGoogleSession(r.email)));
    audit(req, 'google-login-ok', `email=${r.email}`);
    res.redirect('/');
  });

  // MCP OAuth callback (public — verified by state, no login needed)
  app.get('/api/mcp-callback', async (req, res) => {
    const { code, state, error, error_description } = req.query || {};
    if (error) return res.status(400).send(`<h2>❌ MCP login failed: ${String(error_description || error).slice(0, 200)}</h2><p>Go back to Discord and run <code>/mcp login</code> again.</p>`);
    if (!code || !state) return res.status(400).send('<h2>❌ Missing code/state!</h2>');
    const r = await finishMcpLogin(String(code), String(state));
    if (!r.ok) return res.status(400).send(`<h2>❌ ${r.error}</h2><p>Go back to Discord and run <code>/mcp login</code> again.</p>`);
    audit(req, 'mcp-login-ok', `server=${String(r.server || '').slice(0, 40)}`);
    res.send(`<h2>✅ <code>${r.server}</code> connected!</h2><p>Close this tab and use <code>!ai</code> / <code>/mcp test</code> in Discord.</p>`);
  });

  // Pages (homepage + my-code are public, admin pages need admin login)
  app.get('/', (req, res) => res.sendFile(join(__dirname, 'views', 'home.html')));
  app.get('/my-code', (req, res) => res.sendFile(join(__dirname, 'views', 'my-code.html')));
  app.get('/tiers', requireAdminPage, (req, res) => res.sendFile(join(__dirname, 'views', 'tiers.html')));
  app.get('/commands', requireAdminPage, (req, res) => res.sendFile(join(__dirname, 'views', 'commands.html')));
  app.get('/status', requireAdminPage, (req, res) => res.sendFile(join(__dirname, 'views', 'status.html')));
  app.get('/ai', requireAdminPage, (req, res) => res.sendFile(join(__dirname, 'views', 'ai.html')));
  app.get('/codes', (req, res) => res.redirect('/dashboard#codes'));
  app.get('/dashboard', requireAdminPage, (req, res) => res.sendFile(join(__dirname, 'views', 'dashboard.html')));

  // Who am I (any login: admin or member)
  app.get('/api/me', requireLoginApi, (req, res) => {
    res.json({ user: sessionUser(req), role: sessionRole(req), discordId: sessionDiscordId(req) });
  });

  // Personal join code: any Discord login gets 1 code (single-use) for /join
  app.get('/api/my-code', requireLoginApi, (req, res) => {
    const did = sessionDiscordId(req);
    if (!did) return res.status(400).json({ error: 'Login with Discord first! (username/password logins have no Discord ID)' });
    const existing = getPersonalJoinCode(did);
    if (existing && !(existing.expires_at && existing.expires_at < Date.now()) && !(existing.max_uses > 0 && existing.uses >= existing.max_uses)) {
      return res.json({ code: existing.code, created: false, uses: existing.uses, maxUses: existing.max_uses });
    }
    const r = getOrCreatePersonalJoinCode(did);
    if (!r.ok) return res.status(400).json({ error: r.error });
    audit(req, 'my-code', `discord=${did} created=${r.created}`);
    res.json({ code: r.code, created: r.created, uses: 0, maxUses: 1 });
  });

  // Member dashboard page (any login; not-logged-in users see the login CTA inside)
  app.get('/user', (req, res) => res.sendFile(join(__dirname, 'views', 'user.html')));

  // Profile: Discord avatar/username via the bot (nulls when unavailable)
  app.get('/api/profile', requireLoginApi, async (req, res) => {
    const did = sessionDiscordId(req);
    const out = { user: sessionUser(req), role: sessionRole(req), discordId: did, avatar: null, username: null };
    if (!did) return res.json(out);
    try {
      const u = await client.users.fetch(did);
      out.username = u?.username || null;
      out.avatar = u?.displayAvatarURL?.({ size: 128 }) || null;
    } catch { /* unknown user / no shared guilds */ }
    res.json(out);
  });

  // Coding agent preference for a server (any Discord login)
  app.get('/api/coding', requireLoginApi, (req, res) => {
    const did = sessionDiscordId(req);
    if (!did) return res.status(400).json({ error: 'Login with Discord first!' });
    const guild = String(req.query.guild || '').trim();
    if (!checkGuild(guild)) return res.status(400).json({ error: 'Enter a Server ID (right-click server → Copy Server ID)!' });
    res.json({ mode: getCodingPref(guild, did) });
  });

  app.post('/api/coding', requireLoginApi, (req, res) => {
    const did = sessionDiscordId(req);
    if (!did) return res.status(400).json({ error: 'Login with Discord first!' });
    const guild = String(req.body?.guild || '').trim();
    if (!checkGuild(guild)) return res.status(400).json({ error: 'Enter a Server ID (right-click server → Copy Server ID)!' });
    const mode = String(req.body?.mode || '').trim().toLowerCase();
    if (mode !== 'on' && mode !== 'off' && mode !== 'auto') {
      return res.status(400).json({ error: 'mode must be on, off or auto!' });
    }
    setCodingMode(guild, did, mode === 'auto' ? 'auto' : mode === 'on');
    audit(req, 'coding-pref', `discord=${did} guild=${guild} mode=${mode}`);
    res.json({ ok: true, mode });
  });

  // Read-only tier list for a server (any login; same data as !tier show)
  app.get('/api/tiers-view', requireLoginApi, (req, res) => {
    const guild = String(req.query.guild || '').trim();
    if (!checkGuild(guild)) return res.status(400).json({ error: 'Enter a Server ID (right-click server → Copy Server ID)!' });
    const rows = getTierRows(guild);
    const players = getPlayers(guild);
    res.json({
      name: getTierName(guild),
      tiers: rows.map(r => ({
        tier: r.tier,
        emoji: r.emoji,
        players: players.filter(p => p.tier === r.tier).map(p => p.player),
      })),
    });
  });

  // Member AI chat: uses YOUR Discord login/key on that server (rate-limited)
  app.post('/api/my-ai', requireLoginApi, async (req, res) => {
    if (aiRateLimited(getIp(req))) return res.status(429).json({ error: 'Too many requests, slow down!' });
    const did = sessionDiscordId(req);
    if (!did) return res.status(400).json({ error: 'Login with Discord first!' });
    const guild = String(req.body?.guild || '').trim();
    if (!checkGuild(guild)) return res.status(400).json({ error: 'Enter a Server ID (right-click server → Copy Server ID)!' });
    const prompt = String(req.body?.prompt || '').slice(0, 1000).trim();
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    if (hasBadMentions(prompt)) return res.status(400).json({ error: 'No @everyone / @here / role mentions!' });
    const reply = await askAI(prompt, guild, did);
    if (!reply.ok) {
      if (reply.needAuth) return res.status(403).json({ error: `${reply.error} Get your code below, then /join in Discord!` });
      return res.status(503).json({ error: reply.error || 'AI is busy right now, try again later!' });
    }
    let text = reply.text.slice(0, 2000);
    if (reply.files?.length) text += `\n\n📁 Files: ${reply.files.map(f => `\`${f}\``).join(', ')} (download with !get <path> in Discord)`;
    audit(req, 'my-ai', `guild=${guild} mode=${reply.mode || 'chat'}`);
    res.json({ reply: text, mode: reply.mode || 'chat' });
  });

  // Public URL of this dashboard (shown on homepage; safe to share)
  app.get('/api/public-url', (req, res) => {
    const u = String(process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
    res.json({ url: u || null });
  });

  // ---- Tracking + security + files (admin only) ----
  app.get('/activity', requireAdminPage, (req, res) => res.sendFile(join(__dirname, 'views', 'activity.html')));
  app.get('/security', requireAdminPage, (req, res) => res.sendFile(join(__dirname, 'views', 'security.html')));
  app.get('/files', requireAdminPage, (req, res) => res.sendFile(join(__dirname, 'views', 'files.html')));

  // Event search for the Activity page (never leaks secrets: rows hold no keys/tokens by construction).
  app.get('/api/events', requireAdminApi, (req, res) => {
    const q = req.query || {};
    const sinceDays = Math.min(Math.max(Number(q.days) || 7, 1), 30);
    res.json({
      ...queryEvents({
        type: typeof q.type === 'string' ? q.type : null,
        action: typeof q.action === 'string' ? q.action : null,
        user: typeof q.user === 'string' ? q.user : null,
        guildId: typeof q.guild === 'string' ? q.guild : null,
        since: Date.now() - sinceDays * 24 * 3600 * 1000,
        limit: q.limit,
        offset: q.offset,
      }),
      stats: eventStats(),
    });
  });

  // Security posture checklist (booleans only — never secret values).
  app.get('/api/security', requireAdminApi, (req, res) => {
    const dashUrl = String(process.env.DASHBOARD_URL || '');
    res.json({
      checklist: {
        adminAuth: authEnabled(),
        defaultCreds: String(process.env.ADMIN_USER || '') === 'admin' && String(process.env.ADMIN_PASS || '') === 'change_this_password',
        sessionSecretSet: !!String(process.env.SESSION_SECRET || '').trim(),
        dashboardKeyChanged: !!String(process.env.DASHBOARD_KEY || '').trim() && String(process.env.DASHBOARD_KEY) !== 'change_this_secret',
        dashboardHttps: /^https:\/\//i.test(dashUrl),
        discordOAuth: discordConfigured(),
        trustProxy: true,
        joinGate: String(process.env.REQUIRE_JOIN_CODE || '').toLowerCase() === 'true' || !!String(process.env.AI_AUTH_CODE || '').trim(),
      },
      blocks: listBlocks(),
      stats: eventStats(),
    });
  });

  app.post('/api/unblock', requireAdminApi, (req, res) => {
    const { ip, user, all } = req.body || {};
    if (all) {
      clearAllBlocks();
      audit(req, 'unblock-all');
      return res.json({ ok: true });
    }
    let out = { ip: false, user: false };
    if (typeof ip === 'string' && ip) out.ip = unblockIp(ip.slice(0, 64));
    if (typeof user === 'string' && user) out.user = unblockUser(user.slice(0, 100));
    if (!out.ip && !out.user) return res.status(400).json({ error: 'Give ip, user, or all:true!' });
    audit(req, 'unblock', `ip=${out.ip} user=${out.user}`);
    res.json({ ok: true, ...out });
  });

  // Workspace file browser (admin; sandboxed per guild).
  app.get('/api/files', requireAdminApi, (req, res) => {
    const guild = String(req.query.guild || '').trim();
    if (!checkGuild(guild)) return res.status(400).json({ error: 'Missing or invalid ?guild=SERVER_ID (17-20 digits)' });
    res.json({ files: workspaceFiles(guild) });
  });

  app.get('/api/file-download', requireAdminApi, (req, res) => {
    const guild = String(req.query.guild || '').trim();
    const p = String(req.query.path || '').slice(0, 200);
    if (!checkGuild(guild)) return res.status(400).json({ error: 'Missing or invalid ?guild=SERVER_ID' });
    const info = workspaceFileInfo(guild, p);
    if (!info.ok) return res.status(404).json({ error: info.error });
    if (info.size > 20 * 1024 * 1024) return res.status(400).json({ error: 'Too big to download (>20MB)!' });
    audit(req, 'file-download', `guild=${guild} path=${info.rel.slice(0, 100)}`);
    res.download(info.abs, info.rel.split('/').pop());
  });

  // (deferred requireKey lookup: this route is registered before the const below)
  app.delete('/api/files', (req, res, next) => requireKey(req, res, next), (req, res) => {
    const guild = String(req.body?.guild || '').trim();
    const p = String(req.body?.path || '').slice(0, 200);
    if (!checkGuild(guild)) return res.status(400).json({ error: 'Invalid guild' });
    if (!p) return res.status(400).json({ error: 'Missing path' });
    const r = workspaceDeleteFile(guild, p);
    if (!r.ok) return res.status(404).json({ error: r.error });
    audit(req, 'file-delete', `guild=${guild} path=${r.rel.slice(0, 100)}`);
    res.json({ ok: true, path: r.rel });
  });

  // Final safety net: JSON errors only (no HTML stack traces leak internals).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    try { trackEvent({ type: 'security', ip: getIp(req), action: 'server-error', detail: String(err?.message || err).slice(0, 200) }); } catch { /* ignore */ }
    res.status(500).json({ error: 'Something went wrong!' });
  });

  // API
  app.get('/api/health', (req, res) => {    res.json({
      online: !!client.user,
      bot: client.user?.tag || null,
      guilds: client.guilds?.cache.size || 0,
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  app.get('/api/tiers', requireAdminApi, (req, res) => {
    const guild = String(req.query.guild || '');
    if (!checkGuild(guild)) return res.status(400).json({ error: 'Missing or invalid ?guild=SERVER_ID (17-20 digits)' });
    const rows = getTierRows(guild);
    const players = getPlayers(guild);
    res.json({
      name: getTierName(guild),
      tiers: rows.map(r => ({
        tier: r.tier,
        emoji: r.emoji,
        players: players.filter(p => p.tier === r.tier).map(p => p.player),
      })),
    });
  });

  const requireKey = (req, res, next) => {
    if (isAdmin(req)) return next(); // admin login bypasses DASHBOARD_KEY (members blocked)
    if (authEnabled() && !sessionUser(req)) return res.status(401).json({ error: 'Login required', login: true });
    if (sessionUser(req) && !isAdmin(req)) return res.status(403).json({ error: 'Admins only!' });
    if (!KEY) return res.status(403).json({ error: 'Set DASHBOARD_KEY in .env to enable web management' });
    const given = req.body?.key || req.headers['x-dashboard-key']; // no ?key= (leaks in logs)
    if (given !== KEY) return res.status(401).json({ error: 'Invalid key' });
    next();
  };

  app.post('/api/tier', requireKey, (req, res) => {
    const { guild, tier } = req.body;
    if (!checkGuild(String(guild || ''))) return res.status(400).json({ error: 'Invalid guild' });
    const t = String(tier || '').toUpperCase().trim();
    if (!/^[A-Z0-9+\-]{1,10}$/.test(t)) return res.status(400).json({ error: 'Invalid tier name' });
    const ok = createTier(String(guild), t);
    if (ok) audit(req, 'tier-create', `guild=${guild} tier=${t}`);
    res.json(ok ? { ok: true } : { error: 'Tier already exists' });
  });

  app.delete('/api/tier', requireKey, (req, res) => {
    const { guild, tier } = req.body;
    if (!checkGuild(String(guild || ''))) return res.status(400).json({ error: 'Invalid guild' });
    const t = String(tier || '').toUpperCase().trim();
    if (!t) return res.status(400).json({ error: 'Missing guild/tier' });
    const result = deleteTier(String(guild), t);
    if (result === null) return res.status(404).json({ error: 'Tier not found' });
    if (result === 'last') return res.status(400).json({ error: 'Cannot delete the last tier' });
    audit(req, 'tier-delete', `guild=${guild} tier=${t}`);
    res.json({ ok: true, removedPlayers: result });
  });

  app.post('/api/player', requireKey, (req, res) => {
    const { guild, tier, player } = req.body;
    if (!checkGuild(String(guild || ''))) return res.status(400).json({ error: 'Invalid guild' });
    const t = String(tier || '').toUpperCase().trim();
    const p = String(player || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    if (!t || !p) return res.status(400).json({ error: 'Missing guild/tier/player' });
    if (hasBadMentions(p)) return res.status(400).json({ error: 'No @everyone / @here / role mentions!' });
    const ok = addPlayer(String(guild), t, p);
    if (!ok) return res.status(400).json({ error: 'Tier not found or invalid player' });
    audit(req, 'player-add', `guild=${guild} tier=${t}`);
    res.json({ ok: true });
  });

  app.delete('/api/player', requireKey, (req, res) => {
    const { guild, tier, player } = req.body;
    if (!checkGuild(String(guild || ''))) return res.status(400).json({ error: 'Invalid guild' });
    const t = String(tier || '').toUpperCase().trim();
    const p = String(player || '').trim().slice(0, 50);
    if (!t || !p) return res.status(400).json({ error: 'Missing guild/tier/player' });
    const removed = removePlayer(String(guild), t, p);
    if (removed) audit(req, 'player-remove', `guild=${guild} tier=${t}`);
    res.json(removed ? { ok: true } : { error: 'Player not found' });
  });

  app.post('/api/emoji', requireKey, (req, res) => {
    const { guild, tier, emoji } = req.body;
    if (!checkGuild(String(guild || ''))) return res.status(400).json({ error: 'Invalid guild' });
    const t = String(tier || '').toUpperCase().trim();
    if (!t) return res.status(400).json({ error: 'Missing guild/tier' });
    const ok = setTierEmoji(String(guild), t, emoji || null);
    if (ok) audit(req, 'tier-emoji', `guild=${guild} tier=${t}`);
    res.json(ok ? { ok: true } : { error: 'Tier not found' });
  });

  // Dashboard overview: bot + guild summary in one call
  app.get('/api/overview', requireAdminApi, (req, res) => {
    const guild = String(req.query.guild || '').trim();
    if (guild && !checkGuild(guild)) return res.status(400).json({ error: 'Invalid guild (17-20 digits)' });
    const now = Date.now();
    const codes = listJoinCodes(guild || null);
    const activeCodes = codes.filter(c => !c.revoked && (!c.expires_at || c.expires_at > now) && (!c.max_uses || c.uses < c.max_uses)).length;
    const out = {
      online: !!client.user,
      bot: client.user?.tag || null,
      guilds: client.guilds?.cache.size || 0,
      uptimeSec: Math.floor(process.uptime()),
      codeGate: String(process.env.REQUIRE_JOIN_CODE || '').toLowerCase() === 'true' || !!String(process.env.AI_AUTH_CODE || '').trim(),
      codes: { total: codes.length, active: activeCodes },
      mcp: guild ? listMcpServers(guild).map(s => s.name) : null,
      ai: null, tiers: null,
    };
    if (guild) {
      const cfg = getAIConfig(guild);
      const rows = getTierRows(guild);
      const players = getPlayers(guild);
      out.ai = { mode: cfg.mode, provider: cfg.provider, model: getAIConfigFull(guild).model, hasKey: cfg.hasKey };
      out.tiers = { name: getTierName(guild), tierCount: rows.length, playerCount: players.length };
    }
    res.json(out);
  });

  // Join codes: generate 8-digit codes here, users redeem with /join in Discord
  app.get('/api/codes', requireAdminApi, (req, res) => {
    const guild = String(req.query.guild || '').trim();
    if (guild && !checkGuild(guild)) return res.status(400).json({ error: 'Invalid guild (17-20 digits)' });
    res.json({ codes: listJoinCodes(guild || null) });
  });

  app.post('/api/codes', requireKey, (req, res) => {
    const { guild, role, label, maxUses, expiresHours } = req.body || {};
    const g = String(guild || '').trim();
    if (g && !checkGuild(g)) return res.status(400).json({ error: 'Invalid guild (17-20 digits, or empty for all servers)' });
    if (role && role !== 'user' && role !== 'admin') return res.status(400).json({ error: 'Invalid role (user/admin)' });
    const c = createJoinCode(g || null, role || 'user', String(label || '').slice(0, 50) || null, Number(maxUses) || 0, Number(expiresHours) || 0);
    audit(req, 'code-create', `role=${c.role} maxUses=${c.maxUses}`);
    res.json({ ok: true, ...c });
  });

  app.delete('/api/codes', requireKey, (req, res) => {
    const { code } = req.body || {};
    if (!/^\d{8}$/.test(String(code || '').trim())) return res.status(400).json({ error: 'Invalid code (8 digits)' });
    const ok = revokeJoinCode(String(code).trim());
    if (ok) audit(req, 'code-revoke');
    res.json(ok ? { ok: true } : { error: 'Code not found' });
  });

  // AI status (login required, secrets masked)
  app.get('/api/ai-status', requireAdminApi, (req, res) => {
    const guild = String(req.query.guild || '');
    if (!checkGuild(guild)) return res.status(400).json({ error: 'Missing ?guild=SERVER_ID' });
    const cfg = getAIConfig(guild);
    const full = getAIConfigFull(guild);
    res.json({
      mode: cfg.mode,
      provider: cfg.provider || full.provider || null,
      providers: Object.fromEntries(Object.entries(AI_PROVIDERS).map(([k, v]) => [k, { label: v.label, defaultModel: v.defaultModel, keyUrl: v.keyUrl }])),
      baseUrl: cfg.baseUrl,
      model: full.model,
      hasKey: cfg.hasKey,
      maskedKey: maskKey(full.apiKey),
      authRequired: !!process.env.AI_AUTH_CODE && cfg.mode !== 'custom',
    });
  });

  // Set custom AI via dashboard (mods with DASHBOARD_KEY)
  // body: { guild, key, provider?: 'gemini'|'openai'|..., apiKey, model?, baseUrl? }
  app.post('/api/ai-config', requireKey, async (req, res) => {
    const { guild, provider, baseUrl, apiKey, model } = req.body;
    if (!checkGuild(String(guild || ''))) return res.status(400).json({ error: 'Invalid guild' });
    if (!baseUrl && !apiKey && !model && !provider) {
      clearAIConfig(String(guild));
      audit(req, 'ai-config-clear', `guild=${guild}`);
      return res.json({ ok: true, mode: 'free' });
    }
    let v;
    if (provider && AI_PROVIDERS[String(provider).toLowerCase()]) {
      v = validateProviderInput(provider, apiKey, model);
    } else {
      v = validateCustomInput(baseUrl, apiKey, model || 'gpt-3.5-turbo');
    }
    if (v.error) return res.status(400).json({ error: v.error });
    setAICustom(String(guild), v.base, v.key, v.model, v.provider || 'custom');
    audit(req, 'ai-config-set', `guild=${guild} provider=${v.provider || 'custom'} model=${v.model}`);
    // quick test (non-blocking failure is fine)
    const t = await askCustomAI('Say OK', { baseUrl: v.base, apiKey: v.key, model: v.model, provider: v.provider });
    res.json(t.ok ? { ok: true, mode: 'custom', test: 'passed' } : { ok: true, mode: 'custom', test: `failed: ${t.error}` });
  });

  // AI playground — login required, guild-aware (uses custom endpoint if that server configured one)
  app.post('/api/ai', requireAdminApi, async (req, res) => {
    if (aiRateLimited(getIp(req))) return res.status(429).json({ error: 'Too many requests, slow down!' });
    const prompt = String(req.body?.prompt || '').slice(0, 1000).trim();
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    const guild = typeof req.body?.guild === 'string' && checkGuild(req.body.guild) ? req.body.guild : null;
    const reply = await askAI(prompt, guild, null);
    if (!reply.ok) {
      // dashboard has no Discord user, so auth-gated guilds get free AI here
      if (reply.needAuth) {
        const { askFreeAI } = await import('./ai.js');
        const free = await askFreeAI(prompt);
        if (free) return res.json({ reply: free.slice(0, 2000), mode: 'free' });
      }
      return res.status(503).json({ error: reply.error || 'AI is busy right now, try again later!' });
    }
    res.json({ reply: reply.text.slice(0, 2000), mode: reply.mode });
  });

  const server = app.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
  server.on('error', err => console.error('[dashboard]', err.message));
}
