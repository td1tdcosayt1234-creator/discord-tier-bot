// Simple admin login for the web dashboard (no extra deps).
// .env: ADMIN_USER + ADMIN_PASS set -> all pages/APIs (except /login + /api/health) need login.
// Session = signed cookie (HMAC-SHA256), 7 days, HttpOnly.
import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_DAYS = 7;

export function authEnabled() {
  return !!(process.env.ADMIN_USER && process.env.ADMIN_PASS);
}

function secret() {
  return process.env.SESSION_SECRET || process.env.DASHBOARD_KEY || process.env.ADMIN_PASS || 'change-me';
}

function b64urlEncode(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString();
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return timingSafeEqual(ba, bb); } catch { return false; }
}

export function checkLogin(user, pass) {
  const eu = String(process.env.ADMIN_USER || '');
  const ep = String(process.env.ADMIN_PASS || '');
  if (!eu || !ep) return false;
  return safeEqual(user, eu) && safeEqual(pass, ep);
}

export function signSession(user) {
  const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const payload = `${b64urlEncode(user)}.${exp}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifySession(token) {
  try {
    const [u, exp, sig] = String(token || '').split('.');
    if (!u || !exp || !sig) return null;
    if (Number(exp) < Date.now()) return null;
    const expect = createHmac('sha256', secret()).update(`${u}.${exp}`).digest('hex');
    if (!safeEqual(sig, expect)) return null;
    const user = b64urlDecode(u);
    if (user !== String(process.env.ADMIN_USER || '')) return null;
    return user;
  } catch {
    return null;
  }
}

// ---- Discord OAuth sessions (Login with Discord button) ----

export function discordConfigured() {
  return !!(String(process.env.DISCORD_CLIENT_ID || '').trim() && String(process.env.DISCORD_CLIENT_SECRET || '').trim());
}

export function signDiscordSession(discordId, username) {
  const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const payload = `discord.${b64urlEncode(`${discordId}:${username}`)}.${exp}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyDiscordSession(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts[0] !== 'discord' || parts.length !== 4) return null;
    const [, u, exp, sig] = parts;
    if (Number(exp) < Date.now()) return null;
    const expect = createHmac('sha256', secret()).update(`discord.${u}.${exp}`).digest('hex');
    if (!safeEqual(sig, expect)) return null;
    const [id, username] = b64urlDecode(u).split(':');
    if (!id) return null;
    void username;
    return username || `user:${id}`;
  } catch {
    return null;
  }
}

// ---- Dashboard members (any Discord user, non-admin) ----

export function signMemberSession(discordId, username) {
  const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const payload = `member.${b64urlEncode(`${discordId}:${username}`)}.${exp}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyMemberSession(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts[0] !== 'member' || parts.length !== 4) return null;
    const [, u, exp, sig] = parts;
    if (Number(exp) < Date.now()) return null;
    const expect = createHmac('sha256', secret()).update(`member.${u}.${exp}`).digest('hex');
    if (!safeEqual(sig, expect)) return null;
    const [id, username] = b64urlDecode(u).split(':');
    if (!id) return null;
    void username;
    return username || `user:${id}`;
  } catch {
    return null;
  }
}

export function sessionDiscordId(req) {
  try {
    const token = parseCookies(req).tb_session;
    if (!token) return null;
    const parts = String(token).split('.');
    const b64 = parts[0] === 'discord' && parts.length === 4 ? parts[1]
      : parts[0] === 'member' && parts.length === 4 ? parts[1] : null;
    if (!b64) return null;
    const [id] = b64urlDecode(b64).split(':');
    return /^\d{5,25}$/.test(id || '') ? id : null;
  } catch {
    return null;
  }
}

// admin = owner login (ADMIN_USER/PASS, admin Discord, allowlisted Google).
// member = any other Discord login (can only claim a personal /join code).
export function sessionRole(req) {
  if (!authEnabled()) return 'admin';
  const token = parseCookies(req).tb_session;
  if (!token) return null;
  if (token.startsWith('member.')) return verifyMemberSession(token) ? 'member' : null;
  if (sessionUser(req)) return 'admin';
  return null;
}

export function isAdmin(req) {
  return sessionRole(req) === 'admin';
}

// Admin-only pages -> redirect to /login (members go to /user)
export function requireAdminPage(req, res, next) {
  const role = sessionRole(req);
  if (role === 'admin') return next();
  if (role === 'member') return res.redirect('/user');
  if (!authEnabled() || sessionUser(req)) return next();
  return res.redirect('/login');
}

// Admin-only JSON APIs -> 401/403
export function requireAdminApi(req, res, next) {
  const role = sessionRole(req);
  if (role === 'admin') return next();
  if (role === 'member') return res.status(403).json({ error: 'Admins only!' });
  if (!authEnabled() || sessionUser(req)) return next();
  return res.status(401).json({ error: 'Login required', login: true });
}

export function sessionUser(req) {
  if (!authEnabled()) return 'open';
  const token = parseCookies(req).tb_session;
  if (!token) return null;
  if (token.startsWith('discord.')) return verifyDiscordSession(token);
  if (token.startsWith('member.')) return verifyMemberSession(token);
  if (token.startsWith('google.')) return verifyGoogleSession(token);
  return verifySession(token);
}

// Browser pages -> redirect to /login
export function requireLoginPage(req, res, next) {
  if (!authEnabled() || sessionUser(req)) return next();
  return res.redirect('/login');
}

// JSON APIs -> 401
export function requireLoginApi(req, res, next) {
  if (!authEnabled() || sessionUser(req)) return next();
  return res.status(401).json({ error: 'Login required', login: true });
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---- Google dashboard sessions (Continue with Google button) ----

export function signGoogleSession(email) {
  const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const payload = `google.${b64urlEncode(email.toLowerCase())}.${exp}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyGoogleSession(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts[0] !== 'google' || parts.length !== 4) return null;
    const [, u, exp, sig] = parts;
    if (Number(exp) < Date.now()) return null;
    const expect = createHmac('sha256', secret()).update(`google.${u}.${exp}`).digest('hex');
    if (!safeEqual(sig, expect)) return null;
    const email = b64urlDecode(u);
    if (!email || !email.includes('@')) return null;
    return email;
  } catch {
    return null;
  }
}

export function sessionCookie(token, secure = false) {
  return `tb_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 3600}${secure ? '; Secure' : ''}`;
}

export function clearCookie() {
  return 'tb_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';
}

// 5 tries / 5 min per IP for /api/login
const hits = new Map();
export function loginRateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 5 * 60 * 1000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 5;
}

// Brute-force escalation: 10 failed logins from one IP in 30 min -> block 30 min.
// 5 failed logins for one username in 15 min -> that account cools down 15 min.
const ipFails = new Map();
const userFails = new Map();
export function recordLoginFail(ip, user) {
  const now = Date.now();
  ipFails.set(ip, [...(ipFails.get(ip) || []), now].filter(t => now - t < 30 * 60 * 1000));
  userFails.set(user, [...(userFails.get(user) || []), now].filter(t => now - t < 15 * 60 * 1000));
}
export function isIpBlocked(ip) {
  const now = Date.now();
  return ((ipFails.get(ip) || []).filter(t => now - t < 30 * 60 * 1000).length) >= 10;
}
export function isUserBlocked(user) {
  const now = Date.now();
  return ((userFails.get(user) || []).filter(t => now - t < 15 * 60 * 1000).length) >= 5;
}

// ---- Security management (for the /security admin page) ----

export function listBlocks() {
  const now = Date.now();
  const ips = [];
  for (const [ip, arr] of ipFails) {
    const recent = arr.filter(t => now - t < 30 * 60 * 1000);
    if (recent.length >= 10) ips.push({ ip, fails: recent.length });
  }
  const users = [];
  for (const [user, arr] of userFails) {
    const recent = arr.filter(t => now - t < 15 * 60 * 1000);
    if (recent.length >= 5) users.push({ user, fails: recent.length });
  }
  return { ips, users, loginHits: hits.size, throttleHints: null };
}

export function unblockIp(ip) {
  return ipFails.delete(String(ip));
}

export function unblockUser(user) {
  return userFails.delete(String(user));
}

export function clearAllBlocks() {
  ipFails.clear();
  userFails.clear();
  hits.clear();
}
