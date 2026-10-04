import 'dotenv/config';
import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startDashboard } from './src/dashboard.js';
import { handlePanelButton } from './src/aiPanel.js';
import { handleMcpButton, handleMcpModal } from './src/mcpPanel.js';
import { registerSlash, handleSlash, handleAutocomplete } from './src/slash.js';
import { getAISession } from './src/db.js';
import { askAI } from './src/ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREFIX = process.env.PREFIX || '!';

if (!process.env.DISCORD_TOKEN) {
  console.error('[fatal] DISCORD_TOKEN is missing! Copy .env.example to .env and set DISCORD_TOKEN.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Load all commands from src/commands
const commands = new Map();
const commandsDir = join(__dirname, 'src', 'commands');
try {
  for (const file of readdirSync(commandsDir)) {
    if (!file.endsWith('.js')) continue;
    try {
      const mod = await import(`./src/commands/${file}`);
      if (!mod?.default?.name || typeof mod.default.execute !== 'function') {
        console.warn(`[commands] skipped ${file}: missing default { name, execute }`);
        continue;
      }
      commands.set(mod.default.name, mod.default);
    } catch (e) {
      console.error(`[commands] failed to load ${file}:`, e.message);
    }
  }
} catch (e) {
  console.error('[commands] cannot read commands dir:', e.message);
}
console.log(`[commands] loaded: ${[...commands.keys()].join(', ')}`);

// Simple per-user per-command cooldown (spam protection)
const cooldowns = new Map();
const COOLDOWN_MS = 3000;
const AI_COOLDOWN_MS = 10000;
function onCooldown(userId, cmd, ms) {
  const useMs = ms ?? (cmd === 'ai' ? AI_COOLDOWN_MS : COOLDOWN_MS);
  const key = `${userId}:${cmd}`;
  const now = Date.now();
  const last = cooldowns.get(key) || 0;
  if (now - last < useMs) return Math.ceil((useMs - (now - last)) / 1000);
  cooldowns.set(key, now);
  // prune to avoid unbounded memory growth
  if (cooldowns.size > 5000) {
    for (const [k, t] of cooldowns) {
      if (now - t > Math.max(COOLDOWN_MS, AI_COOLDOWN_MS) * 2) cooldowns.delete(k);
      if (cooldowns.size <= 3000) break;
    }
  }
  return 0;
}

async function onReady() {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    client.user.setActivity(`${PREFIX}help | /aipanel`, { type: ActivityType.Playing });
  } catch { /* ignore */ }
  await registerSlash(client).catch(e => console.error('[slash]', e.message));
}
client.once('ready', onReady);
client.once('clientReady', onReady);

client.on('error', console.error);
client.on('shardError', console.error);
client.on('shardDisconnect', e => console.error('[shardDisconnect]', e?.code));
client.on('invalidated', () => console.error('[invalidated] session invalidated'));
client.on('warn', console.warn);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.on('guildMemberAdd', member => {
  const welcomeChannel = member.guild.systemChannel;
  if (welcomeChannel?.isTextBased?.()) {
    welcomeChannel.send(`Welcome to **${member.guild.name}**, ${member}!`).catch(() => {});
  }
});

client.on('messageCreate', async message => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;

    const isPrefixed = message.content.startsWith('!!') || message.content.startsWith(PREFIX);

    // Private AI session: plain text (no !ai needed)
    if (!isPrefixed) {
      const sess = getAISession(message.channel.id);
      if (sess && message.content.trim()) {
        const wait = onCooldown(message.author.id, 'ai');
        if (wait > 0) return message.reply(`Slow down! **${wait}s**.`).catch(() => {});
        const thinking = await message.reply('Thinking...').catch(() => null);
        const r = await askAI(message.content.trim().slice(0, 1000), message.guild.id, message.author.id);
        if (!r || !r.ok) {
          const err = r?.needAuth ? `🔒 ${r.error}\nType \`/join <code>\` with a dashboard code to unlock.` : `⚠️ ${r?.error || 'AI failed!'}`;
          if (thinking) return thinking.edit(err.slice(0, 1900)).catch(() => {});
          return message.reply(err.slice(0, 1900)).catch(() => {});
        }
        let t = String(r.text || '');
        if (t.length > 1900) t = t.slice(0, 1900) + '...';
        if (thinking) return thinking.edit(t).catch(() => {});
        return message.reply(t).catch(() => {});
      }
      return;
    }

    // Support both "!cmd" and "!!cmd" (so !!connect works even when PREFIX="!")
    let usedPrefix = null;
    let rest = '';
    if (message.content.startsWith('!!')) {
      usedPrefix = '!!';
      rest = message.content.slice(2);
    } else if (message.content.startsWith(PREFIX)) {
      usedPrefix = PREFIX;
      rest = message.content.slice(PREFIX.length);
    } else {
      return;
    }
    if (!rest.trim()) return;

    const args = rest.trim().split(/ +/g);
    const commandName = (args.shift() || '').toLowerCase().replace(/^!+/, '');
    if (!commandName) return;

    const command = commands.get(commandName);
    if (!command) {
      const waitUnknown = onCooldown(message.author.id, '__unknown__');
      if (waitUnknown > 0) return;
      return message.reply(`Unknown command! Try \`${usedPrefix}help\`.`).catch(() => {});
    }

    const wait = onCooldown(message.author.id, commandName);
    if (wait > 0) return message.reply(`Slow down! Try again in **${wait}s**.`).catch(() => {});

    await command.execute(message, args, client, usedPrefix);
  } catch (err) {
    console.error('[messageCreate]', err);
    message.reply('Something went wrong!').catch(() => {});
  }
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId?.startsWith('ai_')) {
      await handlePanelButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId?.startsWith('mcp_')) {
      await handleMcpButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId?.startsWith('mcp_')) {
      await handleMcpModal(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      await handleSlash(interaction);
    }
  } catch (e) {
    console.error('[interaction]', e.message);
    if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
      interaction.reply({ content: '⚠️ Something went wrong!', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('[fatal] login failed:', err.message);
  process.exit(1);
});

try {
  startDashboard(client);
} catch (e) {
  console.error('[dashboard] failed to start:', e.message);
}
