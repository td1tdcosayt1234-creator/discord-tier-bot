import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(new URL('../bot.sqlite', import.meta.url));

db.exec(`
  CREATE TABLE IF NOT EXISTS tier_players (
    guild_id TEXT NOT NULL,
    tier TEXT NOT NULL,
    player TEXT NOT NULL,
    PRIMARY KEY (guild_id, player)
  );
  CREATE TABLE IF NOT EXISTS tier_settings (
    guild_id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tiers (
    guild_id TEXT NOT NULL,
    tier TEXT NOT NULL,
    position INTEGER NOT NULL,
    emoji TEXT,
    PRIMARY KEY (guild_id, tier)
  );
  CREATE TABLE IF NOT EXISTS ai_config (
    guild_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'free',
    base_url TEXT,
    api_key TEXT,
    model TEXT,
    provider TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS ai_auth (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    authorized_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS oauth_pending (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    verifier TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'openrouter',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS oauth_login_states (
    state TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    verifier TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_user_keys (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'openrouter',
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS ai_sessions (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mcp_servers (
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    headers TEXT,
    auth TEXT,
    token_url TEXT,
    client_id TEXT,
    client_secret TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, name)
  );
  CREATE TABLE IF NOT EXISTS mcp_oauth_pending (
    state TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    server_name TEXT NOT NULL,
    verifier TEXT NOT NULL,
    token_url TEXT NOT NULL,
    client_id TEXT,
    client_secret TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS join_codes (
    code TEXT PRIMARY KEY,
    guild_id TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    label TEXT,
    max_uses INTEGER NOT NULL DEFAULT 0,
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS bot_admins (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS ai_coding (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'audit',
    user TEXT,
    guild_id TEXT,
    ip TEXT,
    action TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_security_events_time ON security_events (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_security_events_action ON security_events (action);
  CREATE TABLE IF NOT EXISTS ai_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    content TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_ai_history_user ON ai_history (guild_id, user_id, id DESC);
`);
try { db.exec('ALTER TABLE tiers ADD COLUMN emoji TEXT'); } catch { /* column already exists */ }
try { db.exec('ALTER TABLE ai_config ADD COLUMN provider TEXT'); } catch { /* column already exists */ }
for (const col of ['token_url TEXT', 'client_id TEXT', 'client_secret TEXT']) {
  try { db.exec(`ALTER TABLE mcp_servers ADD COLUMN ${col}`); } catch { /* already exists */ }
}
for (const col of ['client_id TEXT', 'client_secret TEXT']) {
  try { db.exec(`ALTER TABLE mcp_oauth_pending ADD COLUMN ${col}`); } catch { /* already exists */ }
}
try { db.exec('ALTER TABLE oauth_pending ADD COLUMN provider TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE oauth_login_states ADD COLUMN verifier TEXT'); } catch { /* already exists */ }

import { DEFAULT_TIERS } from './data.js';
import { sealSecret, openSecret } from './util.js';

export function isValidGuildId(id) {
  return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

export function getTierName(guildId) {
  const row = db.prepare('SELECT name FROM tier_settings WHERE guild_id = ?').get(guildId);
  return row?.name || 'Team Dhurbin Ete Tier List';
}

export function setTierName(guildId, name) {
  const clean = String(name || '').trim().slice(0, 100);
  if (!clean) return false;
  db.prepare('INSERT INTO tier_settings (guild_id, name) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET name = excluded.name').run(guildId, clean);
  return true;
}

export function getTiers(guildId) {
  let rows = db.prepare('SELECT tier FROM tiers WHERE guild_id = ? ORDER BY position').all(guildId);
  if (rows.length === 0) {
    const insert = db.prepare('INSERT INTO tiers (guild_id, tier, position) VALUES (?, ?, ?)');
    DEFAULT_TIERS.forEach((t, i) => insert.run(guildId, t, i));
    rows = db.prepare('SELECT tier FROM tiers WHERE guild_id = ? ORDER BY position').all(guildId);
  }
  return rows.map(r => r.tier);
}

export function getTierRows(guildId) {
  getTiers(guildId); // ensure defaults exist
  return db.prepare('SELECT tier, emoji FROM tiers WHERE guild_id = ? ORDER BY position').all(guildId);
}

export function setTierEmoji(guildId, tier, emoji) {
  const res = db.prepare('UPDATE tiers SET emoji = ? WHERE guild_id = ? AND tier = ?').run(emoji, guildId, tier);
  return res.changes > 0;
}

export function createTier(guildId, tier) {
  const existing = db.prepare('SELECT 1 FROM tiers WHERE guild_id = ? AND tier = ?').get(guildId, tier);
  if (existing) return false;
  const count = db.prepare('SELECT COUNT(*) AS n FROM tiers WHERE guild_id = ?').get(guildId).n;
  db.prepare('INSERT INTO tiers (guild_id, tier, position) VALUES (?, ?, ?)').run(guildId, tier, count);
  return true;
}

export function deleteTier(guildId, tier) {
  const row = db.prepare('SELECT 1 FROM tiers WHERE guild_id = ? AND tier = ?').get(guildId, tier);
  if (!row) return null;
  const total = db.prepare('SELECT COUNT(*) AS n FROM tiers WHERE guild_id = ?').get(guildId).n;
  if (total <= 1) return 'last';
  const players = db.prepare('DELETE FROM tier_players WHERE guild_id = ? AND tier = ?').run(guildId, tier);
  db.prepare('DELETE FROM tiers WHERE guild_id = ? AND tier = ?').run(guildId, tier);
  return players.changes;
}

export function getPlayers(guildId) {
  return db.prepare('SELECT tier, player FROM tier_players WHERE guild_id = ? ORDER BY rowid').all(guildId);
}

function cleanPlayerName(player) {
  return String(player || '').replace(/\s+/g, ' ').trim().slice(0, 50);
}

export function addPlayer(guildId, tier, player) {
  const clean = cleanPlayerName(player);
  if (!clean) return false;
  // tier must exist
  const t = db.prepare('SELECT 1 FROM tiers WHERE guild_id = ? AND tier = ?').get(guildId, tier);
  if (!t) {
    getTiers(guildId);
    const t2 = db.prepare('SELECT 1 FROM tiers WHERE guild_id = ? AND tier = ?').get(guildId, tier);
    if (!t2) return false;
  }
  db.prepare('DELETE FROM tier_players WHERE guild_id = ? AND player = ? COLLATE NOCASE').run(guildId, clean);
  try {
    db.prepare('INSERT INTO tier_players (guild_id, tier, player) VALUES (?, ?, ?)').run(guildId, tier, clean);
  } catch {
    return false;
  }
  return true;
}

export function removePlayer(guildId, tier, player) {
  const clean = cleanPlayerName(player);
  if (!clean) return false;
  const res = db.prepare('DELETE FROM tier_players WHERE guild_id = ? AND tier = ? AND player = ? COLLATE NOCASE').run(guildId, tier, clean);
  return res.changes > 0;
}

export function resetTierList(guildId) {
  db.prepare('DELETE FROM tier_players WHERE guild_id = ?').run(guildId);
}

// ---------- AI connection config (per-guild) ----------

export function getAIConfig(guildId) {
  const row = db.prepare('SELECT mode, base_url, api_key, model, provider FROM ai_config WHERE guild_id = ?').get(guildId);
  if (!row) return { mode: 'free', provider: null, baseUrl: null, hasKey: false, model: null };
  return {
    mode: row.mode === 'custom' ? 'custom' : 'free',
    provider: row.provider || null,
    baseUrl: row.base_url || null,
    hasKey: !!row.api_key,
    model: row.model || null,
  };
}

export function getAIConfigFull(guildId) {
  const row = db.prepare('SELECT mode, base_url, api_key, model, provider FROM ai_config WHERE guild_id = ?').get(guildId);
  if (!row) return { mode: 'free', provider: null, baseUrl: null, apiKey: null, model: null };
  return {
    mode: row.mode === 'custom' ? 'custom' : 'free',
    provider: row.provider || null,
    baseUrl: row.base_url || null,
    apiKey: openSecret(row.api_key),
    model: row.model || null,
  };
}

export function setAICustom(guildId, baseUrl, apiKey, model, provider) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO ai_config (guild_id, mode, base_url, api_key, model, provider, updated_at)
     VALUES (?, 'custom', ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET mode='custom', base_url=excluded.base_url, api_key=excluded.api_key, model=excluded.model, provider=excluded.provider, updated_at=excluded.updated_at`
  ).run(guildId, baseUrl, sealSecret(apiKey), model || null, provider || null, now);
}

export function setAIModel(guildId, model) {
  const res = db.prepare(`UPDATE ai_config SET model = ?, updated_at = ? WHERE guild_id = ? AND mode = 'custom'`).run(model, Date.now(), guildId);
  return res.changes > 0;
}

export function clearAIConfig(guildId) {
  db.prepare('DELETE FROM ai_config WHERE guild_id = ?').run(guildId);
}

export function isUserAuthorized(guildId, userId) {
  const row = db.prepare('SELECT 1 FROM ai_auth WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return !!row;
}

export function authorizeUser(guildId, userId) {
  db.prepare(
    'INSERT INTO ai_auth (guild_id, user_id, authorized_at) VALUES (?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET authorized_at = excluded.authorized_at'
  ).run(guildId, userId, Date.now());
}

export function revokeUser(guildId, userId) {
  const res = db.prepare('DELETE FROM ai_auth WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  return res.changes > 0;
}

export function countAuthorized(guildId) {
  return db.prepare('SELECT COUNT(*) AS n FROM ai_auth WHERE guild_id = ?').get(guildId).n;
}

// ---------- OAuth login (no API key paste, Notion-MCP style) ----------

export function saveOAuthPending(guildId, userId, verifier, provider = 'openrouter') {
  db.prepare(
    'INSERT INTO oauth_pending (guild_id, user_id, verifier, provider, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET verifier=excluded.verifier, provider=excluded.provider, created_at=excluded.created_at'
  ).run(guildId, userId, verifier, provider, Date.now());
}

export function getOAuthPending(guildId, userId, provider = null) {
  const row = db.prepare('SELECT verifier, provider, created_at FROM oauth_pending WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (!row) return null;
  if (Date.now() - row.created_at > 10 * 60 * 1000) {
    db.prepare('DELETE FROM oauth_pending WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
    return null;
  }
  if (provider && row.provider !== provider) return null;
  return row.verifier;
}

export function clearOAuthPending(guildId, userId) {
  db.prepare('DELETE FROM oauth_pending WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

// Browser-redirect logins: state -> who started it (10 min valid, single use)
export function saveOAuthState(state, guildId, userId, provider, verifier = null) {
  db.prepare(
    'INSERT INTO oauth_login_states (state, guild_id, user_id, provider, verifier, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(state) DO UPDATE SET guild_id=excluded.guild_id, user_id=excluded.user_id, provider=excluded.provider, verifier=excluded.verifier, created_at=excluded.created_at'
  ).run(state, guildId, userId, provider, verifier, Date.now());
}

export function consumeOAuthState(state) {
  const row = db.prepare('SELECT guild_id, user_id, provider, verifier, created_at FROM oauth_login_states WHERE state = ?').get(state);
  if (row) db.prepare('DELETE FROM oauth_login_states WHERE state = ?').run(state);
  if (!row || Date.now() - row.created_at > 10 * 60 * 1000) return null;
  return row;
}

export function setUserKey(guildId, userId, provider, baseUrl, apiKey, model) {
  db.prepare(
    `INSERT INTO ai_user_keys (guild_id, user_id, provider, base_url, api_key, model, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id)
     DO UPDATE SET provider=excluded.provider, base_url=excluded.base_url, api_key=excluded.api_key, model=excluded.model, updated_at=excluded.updated_at`
  ).run(guildId, userId, provider, baseUrl, sealSecret(apiKey), model || null, Date.now());
}

export function getUserKey(guildId, userId) {
  const row = db.prepare('SELECT provider, base_url, api_key, model FROM ai_user_keys WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (!row) return null;
  return { provider: row.provider, base_url: row.base_url, api_key: openSecret(row.api_key), model: row.model };
}

export function clearUserKey(guildId, userId) {
  const res = db.prepare('DELETE FROM ai_user_keys WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  return res.changes > 0;
}

export function setUserModel(guildId, userId, model) {
  const res = db.prepare('UPDATE ai_user_keys SET model = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?')
    .run(String(model).slice(0, 120), Date.now(), guildId, userId);
  return res.changes > 0;
}

// ---------- AI private sessions (panel -> private channel) ----------

export function createAISession(channelId, guildId, userId) {
  db.prepare(
    'INSERT INTO ai_sessions (channel_id, guild_id, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET guild_id=excluded.guild_id, user_id=excluded.user_id, created_at=excluded.created_at'
  ).run(channelId, guildId, userId, Date.now());
}

export function getAISession(channelId) {
  return db.prepare('SELECT channel_id, guild_id, user_id FROM ai_sessions WHERE channel_id = ?').get(channelId) || null;
}

export function deleteAISession(channelId) {
  const res = db.prepare('DELETE FROM ai_sessions WHERE channel_id = ?').run(channelId);
  return res.changes > 0;
}

export function getUserSessions(guildId, userId) {
  return db.prepare('SELECT channel_id FROM ai_sessions WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10').all(guildId, userId);
}

// ---------- Join codes (8-digit, generated in admin panel, redeemed via /join) ----------

function randomJoinCode() {
  let n = '';
  for (let i = 0; i < 8; i++) n += Math.floor(Math.random() * 10);
  return n;
}

export function createJoinCode(guildId, role = 'user', label = null, maxUses = 0, expiresHours = 0) {
  role = role === 'admin' ? 'admin' : 'user';
  let code = randomJoinCode();
  for (let i = 0; i < 10; i++) {
    if (!db.prepare('SELECT 1 FROM join_codes WHERE code = ?').get(code)) break;
    code = randomJoinCode();
  }
  const expiresAt = expiresHours > 0 ? Date.now() + expiresHours * 3600 * 1000 : 0;
  db.prepare(
    'INSERT INTO join_codes (code, guild_id, role, label, max_uses, uses, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?)'
  ).run(code, guildId || null, role, label || null, Math.max(0, maxUses | 0), expiresAt, Date.now());
  return { code, role, maxUses: Math.max(0, maxUses | 0), expiresAt };
}

export function listJoinCodes(guildId) {
  if (guildId) return db.prepare('SELECT code, role, label, max_uses, uses, expires_at, revoked, created_at FROM join_codes WHERE guild_id = ? OR guild_id IS NULL ORDER BY created_at DESC LIMIT 100').all(guildId);
  return db.prepare('SELECT code, guild_id, role, label, max_uses, uses, expires_at, revoked, created_at FROM join_codes ORDER BY created_at DESC LIMIT 100').all();
}

export function revokeJoinCode(code) {
  const res = db.prepare('UPDATE join_codes SET revoked = 1 WHERE code = ?').run(String(code).trim());
  return res.changes > 0;
}

// Returns { ok, role? } or { ok: false, error }
export function redeemJoinCode(rawCode, guildId, userId) {
  const code = String(rawCode || '').replace(/\D/g, '').slice(0, 8);
  if (code.length !== 8) return { ok: false, error: 'Invalid code! It must be 8 digits. Usage: `/join 12345678`.' };
  const row = db.prepare('SELECT * FROM join_codes WHERE code = ?').get(code);
  if (!row) return { ok: false, error: 'Wrong code! Check it and try again.' };
  if (row.revoked) return { ok: false, error: 'This code was revoked! Ask an admin for a new one.' };
  if (row.guild_id && row.guild_id !== guildId) return { ok: false, error: 'This code is for another server!' };
  if (row.expires_at && row.expires_at < Date.now()) return { ok: false, error: 'This code expired! Ask an admin for a new one.' };
  if (row.max_uses > 0 && row.uses >= row.max_uses) return { ok: false, error: 'This code is used up! Ask an admin for a new one.' };
  db.prepare('UPDATE join_codes SET uses = uses + 1 WHERE code = ?').run(code);
  authorizeUser(guildId, userId);
  if (row.role === 'admin') {
    db.prepare('INSERT INTO bot_admins (guild_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT(guild_id, user_id) DO NOTHING').run(guildId, userId, Date.now());
  }
  return { ok: true, role: row.role };
}

export function isBotAdmin(guildId, userId) {
  return !!db.prepare('SELECT 1 FROM bot_admins WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

// ---------- AI coding agent mode (per-user toggle, tools: files/zip/mcp only) ----------

export function isCodingMode(guildId, userId) {
  const row = db.prepare('SELECT enabled FROM ai_coding WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return row?.enabled === 1;
}

// 'on' = always agent, 'off' = never tools, 'auto' (default, no row) = tools only when needed.
export function getCodingPref(guildId, userId) {
  const row = db.prepare('SELECT enabled FROM ai_coding WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (!row) return 'auto';
  return row.enabled === 1 ? 'on' : 'off';
}

export function setCodingMode(guildId, userId, on) {
  if (on === 'auto' || on === null) {
    db.prepare('DELETE FROM ai_coding WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
    return 'auto';
  }
  db.prepare(
    'INSERT INTO ai_coding (guild_id, user_id, enabled, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at'
  ).run(guildId, userId, on ? 1 : 0, Date.now());
  return on ? 'on' : 'off';
}

// ---------- Personal join codes (dashboard members: 1 code per Discord user) ----------

export function getPersonalJoinCode(discordId) {
  const label = `member:${String(discordId || '').trim()}`;
  return db.prepare('SELECT code, role, label, max_uses, uses, expires_at, revoked, created_at FROM join_codes WHERE label = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 1').get(label) || null;
}

export function getOrCreatePersonalJoinCode(discordId) {
  const id = String(discordId || '').trim();
  if (!/^\d{5,25}$/.test(id)) return { ok: false, error: 'Invalid Discord account!' };
  const existing = getPersonalJoinCode(id);
  if (existing) {
    if (existing.expires_at && existing.expires_at < Date.now()) {
      revokeJoinCode(existing.code);
    } else if (!(existing.max_uses > 0 && existing.uses >= existing.max_uses)) {
      return { ok: true, code: existing.code, created: false };
    }
  }
  const c = createJoinCode(null, 'user', `member:${id}`, 1, 0);
  return { ok: true, code: c.code, created: true };
}

// ---------- Tracking + security events (dashboard audit, logins, blocks) ----------

const EVENT_TYPES = new Set(['audit', 'login', 'ai', 'tier', 'code', 'mcp', 'coding', 'file', 'security']);
let eventInserts = 0;

export function trackEvent({ type = 'audit', user = null, guildId = null, ip = null, action, detail = null }) {
  const t = EVENT_TYPES.has(String(type)) ? String(type) : 'audit';
  const a = String(action || '').slice(0, 64);
  if (!a) return null;
  try {
    const r = db.prepare(
      'INSERT INTO security_events (created_at, type, user, guild_id, ip, action, detail) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(Date.now(), t, user ? String(user).slice(0, 100) : null, guildId ? String(guildId).slice(0, 32) : null,
      ip ? String(ip).slice(0, 64) : null, a, detail ? String(detail).slice(0, 500) : null);
    if (++eventInserts % 50 === 0) pruneEvents();
    return Number(r.lastInsertRowid) || null;
  } catch {
    return null;
  }
}

export function pruneEvents() {
  try {
    db.prepare('DELETE FROM security_events WHERE created_at < ?').run(Date.now() - 30 * 24 * 3600 * 1000);
    db.prepare('DELETE FROM security_events WHERE id NOT IN (SELECT id FROM security_events ORDER BY id DESC LIMIT 20000)').run();
  } catch { /* ignore */ }
}

export function queryEvents({ type = null, action = null, user = null, guildId = null, since = 0, limit = 100, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (type && EVENT_TYPES.has(String(type))) { where.push('type = ?'); args.push(String(type)); }
  if (action) { where.push('action = ?'); args.push(String(action).slice(0, 64)); }
  if (user) { where.push('user LIKE ?'); args.push(`%${String(user).slice(0, 50)}%`); }
  if (guildId) { where.push('guild_id = ?'); args.push(String(guildId).slice(0, 32)); }
  if (Number(since) > 0) { where.push('created_at >= ?'); args.push(Number(since)); }
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const sql = `SELECT id, created_at, type, user, guild_id, ip, action, detail FROM security_events` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') + ` ORDER BY id DESC LIMIT ${lim} OFFSET ${off}`;
  const rows = db.prepare(sql).all(...args);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM security_events` + (where.length ? ` WHERE ${where.join(' AND ')}` : '')).get(...args)?.n || 0;
  return { rows, total };
}

export function eventStats() {
  try {
    const total = db.prepare('SELECT COUNT(*) AS n FROM security_events').get()?.n || 0;
    const day = db.prepare('SELECT COUNT(*) AS n FROM security_events WHERE created_at >= ?').get(Date.now() - 24 * 3600 * 1000)?.n || 0;
    const fails = db.prepare(`SELECT COUNT(*) AS n FROM security_events WHERE action IN ('login-fail','login-blocked') AND created_at >= ?`).get(Date.now() - 24 * 3600 * 1000)?.n || 0;
    const byType = db.prepare('SELECT type, COUNT(*) AS n FROM security_events WHERE created_at >= ? GROUP BY type').all(Date.now() - 24 * 3600 * 1000);
    return { total, last24h: day, loginFails24h: fails, byType };
  } catch {
    return { total: 0, last24h: 0, loginFails24h: 0, byType: [] };
  }
}

// ---------- Chat memory (per server + user, last exchanges) ----------

const HISTORY_KEEP = 20; // rows kept per user (10 exchanges)
const HISTORY_SEND = 8; // messages sent to the model (4 exchanges)
export const HISTORY_CHARS = 1500; // stored chars per message

export function getHistory(guildId, userId, limit = HISTORY_SEND) {
  try {
    const lim = Math.min(Math.max(Number(limit) || HISTORY_SEND, 1), 20);
    const rows = db.prepare(
      'SELECT role, content FROM ai_history WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?'
    ).all(String(guildId), String(userId), lim);
    return rows.reverse()
      .filter(r => (r.role === 'user' || r.role === 'assistant') && r.content)
      .map(r => ({ role: r.role, content: String(r.content) }));
  } catch {
    return [];
  }
}

export function saveExchange(guildId, userId, userText, aiText) {
  try {
    const u = String(userText || '').slice(0, HISTORY_CHARS).trim();
    const a = String(aiText || '').slice(0, HISTORY_CHARS).trim();
    if (!u || !a) return;
    const now = Date.now();
    const ins = db.prepare('INSERT INTO ai_history (guild_id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
    ins.run(String(guildId), String(userId), 'user', u, now);
    ins.run(String(guildId), String(userId), 'assistant', a, now);
    db.prepare(
      'DELETE FROM ai_history WHERE guild_id = ? AND user_id = ? AND id NOT IN (SELECT id FROM ai_history WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?)'
    ).run(String(guildId), String(userId), String(guildId), String(userId), HISTORY_KEEP);
  } catch { /* ignore */ }
}

export function clearHistory(guildId, userId) {
  try {
    const res = db.prepare('DELETE FROM ai_history WHERE guild_id = ? AND user_id = ?').run(String(guildId), String(userId));
    return res.changes > 0;
  } catch {
    return false;
  }
}

// ---------- MCP OAuth pending (Notion-style login, no token paste) ----------

export function saveMcpOAuth(state, guildId, serverName, verifier, tokenUrl, clientId, clientSecret) {
  db.prepare(
    'INSERT INTO mcp_oauth_pending (state, guild_id, server_name, verifier, token_url, client_id, client_secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(state) DO UPDATE SET verifier=excluded.verifier, token_url=excluded.token_url, client_id=excluded.client_id, client_secret=excluded.client_secret, created_at=excluded.created_at'
  ).run(state, guildId, serverName, verifier, tokenUrl, clientId || null, clientSecret || null, Date.now());
}

export function getMcpOAuth(state) {
  const row = db.prepare('SELECT guild_id, server_name, verifier, token_url, client_id, client_secret, created_at FROM mcp_oauth_pending WHERE state = ?').get(state);
  if (!row) return null;
  if (Date.now() - row.created_at > 10 * 60 * 1000) {
    db.prepare('DELETE FROM mcp_oauth_pending WHERE state = ?').run(state);
    return null;
  }
  return row;
}

export function clearMcpOAuth(state) {
  db.prepare('DELETE FROM mcp_oauth_pending WHERE state = ?').run(state);
}

// ---------- MCP servers (per-guild) ----------

export function upsertMcpServer(guildId, name, baseUrl, headers, auth) {
  db.prepare(
    'INSERT INTO mcp_servers (guild_id, name, base_url, headers, auth, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, name) DO UPDATE SET base_url=excluded.base_url, headers=excluded.headers, auth=excluded.auth, created_at=excluded.created_at'
  ).run(guildId, name, baseUrl, headers || null, sealSecret(auth), Date.now());
}

export function listMcpServers(guildId) {
  return db.prepare('SELECT guild_id, name, base_url, headers, (auth IS NOT NULL) AS has_auth, token_url FROM mcp_servers WHERE guild_id = ? ORDER BY name').all(guildId)
    .map(r => ({ guild_id: r.guild_id, name: r.name, base_url: r.base_url, headers: r.headers, hasAuth: !!r.has_auth, token_url: r.token_url }));
}

export function getMcpServer(guildId, name) {
  const row = db.prepare('SELECT guild_id, name, base_url, headers, auth, token_url, client_id, client_secret FROM mcp_servers WHERE guild_id = ? AND name = ? COLLATE NOCASE').get(guildId, name);
  if (!row) return null;
  return { ...row, auth: openSecret(row.auth), client_secret: openSecret(row.client_secret) };
}

export function setMcpOAuthCreds(guildId, name, { tokenUrl, clientId, clientSecret, accessToken, refreshToken, expiresIn }) {
  const authJson = JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken || null,
    expires_at: Date.now() + (Number(expiresIn) || 3600) * 1000,
  });
  db.prepare('UPDATE mcp_servers SET auth = ?, token_url = ?, client_id = ?, client_secret = ? WHERE guild_id = ? AND name = ? COLLATE NOCASE')
    .run(sealSecret(authJson), tokenUrl || null, clientId || null, sealSecret(clientSecret), guildId, name);
}

export function deleteMcpServer(guildId, name) {
  const res = db.prepare('DELETE FROM mcp_servers WHERE guild_id = ? AND name = ? COLLATE NOCASE').run(guildId, name);
  return res.changes > 0;
}
