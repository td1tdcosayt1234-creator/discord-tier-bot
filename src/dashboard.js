import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  getTierName, getTierRows, getPlayers,
  createTier, deleteTier, addPlayer, removePlayer, setTierEmoji,
} from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startDashboard(client) {
  const app = express();
  const PORT = process.env.PORT || 3000;
  const KEY = process.env.DASHBOARD_KEY;

  app.use(express.json());
  app.use(express.static(join(__dirname, 'public')));

  // Pages
  app.get('/', (req, res) => res.sendFile(join(__dirname, 'views', 'home.html')));
  app.get('/tiers', (req, res) => res.sendFile(join(__dirname, 'views', 'tiers.html')));
  app.get('/commands', (req, res) => res.sendFile(join(__dirname, 'views', 'commands.html')));
  app.get('/status', (req, res) => res.sendFile(join(__dirname, 'views', 'status.html')));

  // API
  app.get('/api/health', (req, res) => {
    res.json({
      online: !!client.user,
      bot: client.user?.tag || null,
      guilds: client.guilds?.cache.size || 0,
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  app.get('/api/tiers', (req, res) => {
    const guild = req.query.guild;
    if (!guild) return res.status(400).json({ error: 'Missing ?guild=SERVER_ID' });
    const rows = getTierRows(String(guild));
    const players = getPlayers(String(guild));
    res.json({
      name: getTierName(String(guild)),
      tiers: rows.map(r => ({
        tier: r.tier,
        emoji: r.emoji,
        players: players.filter(p => p.tier === r.tier).map(p => p.player),
      })),
    });
  });

  const requireKey = (req, res, next) => {
    if (!KEY) return res.status(403).json({ error: 'Set DASHBOARD_KEY in .env to enable web management' });
    if ((req.body?.key || req.query.key) !== KEY) return res.status(401).json({ error: 'Invalid key' });
    next();
  };

  app.post('/api/tier', requireKey, (req, res) => {
    const { guild, tier } = req.body;
    if (!guild || !tier) return res.status(400).json({ error: 'Missing guild/tier' });
    const ok = createTier(String(guild), String(tier).toUpperCase());
    res.json(ok ? { ok: true } : { error: 'Tier already exists' });
  });

  app.delete('/api/tier', requireKey, (req, res) => {
    const { guild, tier } = req.body;
    if (!guild || !tier) return res.status(400).json({ error: 'Missing guild/tier' });
    const result = deleteTier(String(guild), String(tier).toUpperCase());
    if (result === null) return res.status(404).json({ error: 'Tier not found' });
    if (result === 'last') return res.status(400).json({ error: 'Cannot delete the last tier' });
    res.json({ ok: true, removedPlayers: result });
  });

  app.post('/api/player', requireKey, (req, res) => {
    const { guild, tier, player } = req.body;
    if (!guild || !tier || !player) return res.status(400).json({ error: 'Missing guild/tier/player' });
    addPlayer(String(guild), String(tier).toUpperCase(), String(player));
    res.json({ ok: true });
  });

  app.delete('/api/player', requireKey, (req, res) => {
    const { guild, tier, player } = req.body;
    if (!guild || !tier || !player) return res.status(400).json({ error: 'Missing guild/tier/player' });
    const removed = removePlayer(String(guild), String(tier).toUpperCase(), String(player));
    res.json(removed ? { ok: true } : { error: 'Player not found' });
  });

  app.post('/api/emoji', requireKey, (req, res) => {
    const { guild, tier, emoji } = req.body;
    if (!guild || !tier) return res.status(400).json({ error: 'Missing guild/tier' });
    const ok = setTierEmoji(String(guild), String(tier).toUpperCase(), emoji || null);
    res.json(ok ? { ok: true } : { error: 'Tier not found' });
  });

  const server = app.listen(PORT, () => console.log(`🌐 Dashboard: http://localhost:${PORT}`));
  server.on('error', err => console.error('[dashboard]', err.message));
}
