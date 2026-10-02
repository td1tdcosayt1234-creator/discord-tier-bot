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
`);

export function getTierName(guildId) {
  const row = db.prepare('SELECT name FROM tier_settings WHERE guild_id = ?').get(guildId);
  return row?.name || 'Team Dhurbin Ete Tier List';
}

export function setTierName(guildId, name) {
  db.prepare('INSERT INTO tier_settings (guild_id, name) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET name = excluded.name').run(guildId, name);
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
