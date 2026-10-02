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
`);
try { db.exec('ALTER TABLE tiers ADD COLUMN emoji TEXT'); } catch { /* column already exists */ }

import { DEFAULT_TIERS } from './data.js';

export function getTierName(guildId) {
  const row = db.prepare('SELECT name FROM tier_settings WHERE guild_id = ?').get(guildId);
  return row?.name || 'Team Dhurbin Ete Tier List';
}

export function setTierName(guildId, name) {
  db.prepare('INSERT INTO tier_settings (guild_id, name) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET name = excluded.name').run(guildId, name);
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

export function addPlayer(guildId, tier, player) {
  db.prepare('DELETE FROM tier_players WHERE guild_id = ? AND player = ? COLLATE NOCASE').run(guildId, player);
  db.prepare('INSERT INTO tier_players (guild_id, tier, player) VALUES (?, ?, ?)').run(guildId, tier, player);
}

export function removePlayer(guildId, tier, player) {
  const res = db.prepare('DELETE FROM tier_players WHERE guild_id = ? AND tier = ? AND player = ? COLLATE NOCASE').run(guildId, tier, player);
  return res.changes > 0;
}

export function resetTierList(guildId) {
  db.prepare('DELETE FROM tier_players WHERE guild_id = ?').run(guildId);
}
