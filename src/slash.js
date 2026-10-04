import { SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionsBitField } from 'discord.js';
import { askAI, validateProviderInput, validateCustomInput, maskKey, isAuthRequired, AI_PROVIDERS } from './ai.js';
import { createLogin, exchangeCode, startHFDevice, pollHFDevice, saveHFLogin, startGoogleLogin, startGitHubDevice, pollGitHubDevice, saveGitHubLogin } from './oauth.js';
import { buildPanel, createSessionChannel } from './aiPanel.js';
import { buildMcpPanel } from './mcpPanel.js';
import { startMcpLogin } from './mcpAuth.js';
import { testMcpServer, listMcpTools, callMcpTool, normalizeMcpUrl, validMcpName, parseHeaders, maskAuth } from './mcp.js';
import {
  getAIConfig, getAIConfigFull, setAICustom, setAIModel, clearAIConfig,
  authorizeUser, revokeUser, isUserAuthorized, countAuthorized, getUserKey, clearUserKey,
  getTierName, getTierRows, getPlayers, createTier, deleteTier, addPlayer, removePlayer, setTierEmoji, setTierName, resetTierList,
  getAISession, deleteAISession, getUserSessions, isValidGuildId,
  upsertMcpServer, listMcpServers, getMcpServer, deleteMcpServer,
  createJoinCode, listJoinCodes, revokeJoinCode, redeemJoinCode, isBotAdmin,
  getCodingPref, setCodingMode,
} from './db.js';
import { EIGHT_BALL_RESPONSES, JOKES } from './data.js';
import { hasBadMentions } from './util.js';

function modOnly(interaction) {
  try {
    const m = interaction.memberPermissions;
    if (m?.has(PermissionsBitField.Flags.ManageMessages) || m?.has(PermissionsBitField.Flags.ManageGuild)) return true;
    if (interaction.guildId && isBotAdmin(interaction.guildId, interaction.user.id)) return true;
  } catch { /* fall through to deny */ }
  interaction.reply({ content: '❌ Mods only!', ephemeral: true }).catch(() => {});
  return false;
}

// Guild-only guard: slash commands that need a server (tier/mcp/join/connect state)
function needGuild(interaction) {
  if (!interaction.guildId || !interaction.guild) {
    interaction.reply({ content: '❌ Server-only command! Use this inside a server, not DMs.', ephemeral: true }).catch(() => {});
    return false;
  }
  return true;
}

// Never echo @everyone/@here/role pings from AI/MCP output back into Discord.
function sanitizeReply(s) {
  return String(s || '')
    .replace(/@everyone/gi, '@\u200beveryone')
    .replace(/@here/gi, '@\u200bhere')
    .replace(/<@&(\d+)>/g, '<@\u200b&$1>');
}

// 5 join tries / 5 min per user
const joinHits = new Map();
function joinRateLimited(uid) {
  const now = Date.now();
  const arr = (joinHits.get(uid) || []).filter(t => now - t < 5 * 60 * 1000);
  arr.push(now);
  joinHits.set(uid, arr);
  return arr.length > 5;
}

export function slashDefs() {
  const ai = new SlashCommandBuilder().setName('ai').setDescription('Ask the AI')
    .addStringOption(o => o.setName('prompt').setDescription('Your question').setRequired(true).setMaxLength(1000));
  const aipanel = new SlashCommandBuilder().setName('aipanel').setDescription('Post AI chat panel with buttons (mods)');
  const ainew = new SlashCommandBuilder().setName('ainew').setDescription('Open your private AI channel');
  const aiclose = new SlashCommandBuilder().setName('aiclose').setDescription('Close this AI chat channel');

  const connect = new SlashCommandBuilder().setName('connect').setDescription('Connect AI (login / auth / provider)');
  connect.addSubcommand(s => s.setName('status').setDescription('Show AI mode + your login'));
  connect.addSubcommand(s => s.setName('login').setDescription('Log in on site, no API key needed')
    .addStringOption(o => o.setName('provider').setDescription('Login provider').setRequired(false)
      .addChoices({ name: 'openrouter', value: 'openrouter' }, { name: 'google', value: 'google' }, { name: 'huggingface', value: 'huggingface' }, { name: 'github', value: 'github' })));
  connect.addSubcommand(s => s.setName('code').setDescription('Paste login code').addStringOption(o => o.setName('code').setDescription('Code from site').setRequired(true)));
  connect.addSubcommand(s => s.setName('auth').setDescription('Unlock with owner code').addStringOption(o => o.setName('code').setDescription('Owner code').setRequired(true)));
  connect.addSubcommand(s => s.setName('logout').setDescription('Remove your login/auth'));
  connect.addSubcommand(s => s.setName('test').setDescription('Test current AI').addStringOption(o => o.setName('question').setDescription('Test text').setRequired(false)));
  connect.addSubcommand(s => s.setName('free').setDescription('Back to free AI (mods)'));
  connect.addSubcommand(s => s.setName('key').setDescription('Connect platform key (mods)')
    .addStringOption(o => o.setName('provider').setDescription('Key provider: gemini, openai, groq, github-models, ...').setRequired(true))
    .addStringOption(o => o.setName('key').setDescription('API key').setRequired(true))
    .addStringOption(o => o.setName('model').setDescription('Model (default auto)').setRequired(false)));
  connect.addSubcommand(s => s.setName('api').setDescription('Custom base URL (mods)')
    .addStringOption(o => o.setName('base_url').setDescription('https://...').setRequired(true))
    .addStringOption(o => o.setName('key').setDescription('API key').setRequired(true))
    .addStringOption(o => o.setName('model').setDescription('Model').setRequired(false)));
  connect.addSubcommand(s => s.setName('model').setDescription('Change model (free list: type to search)').addStringOption(o => o.setName('name').setDescription('Pick a free OpenRouter model').setRequired(true).setAutocomplete(true)));
  connect.addSubcommand(s => s.setName('models').setDescription('List free OpenRouter models').addStringOption(o => o.setName('search').setDescription('Filter by name').setRequired(false)));

  const tier = new SlashCommandBuilder().setName('tier').setDescription('Tier list');
  tier.addSubcommand(s => s.setName('show').setDescription('Show tier list'));
  tier.addSubcommand(s => s.setName('create').setDescription('Create tier (mods)').addStringOption(o => o.setName('name').setDescription('SS').setRequired(true)));
  tier.addSubcommand(s => s.setName('delete').setDescription('Delete tier (mods)').addStringOption(o => o.setName('name').setDescription('SS').setRequired(true)));
  tier.addSubcommand(s => s.setName('add').setDescription('Add player (mods)').addStringOption(o => o.setName('tier').setDescription('S').setRequired(true)).addStringOption(o => o.setName('player').setDescription('Name').setRequired(true)));
  tier.addSubcommand(s => s.setName('remove').setDescription('Remove player (mods)').addStringOption(o => o.setName('tier').setDescription('S').setRequired(true)).addStringOption(o => o.setName('player').setDescription('Name').setRequired(true)));
  tier.addSubcommand(s => s.setName('emoji').setDescription('Set tier emoji (mods)').addStringOption(o => o.setName('tier').setDescription('S').setRequired(true)).addStringOption(o => o.setName('emoji').setDescription('👑 or clear').setRequired(true)));
  tier.addSubcommand(s => s.setName('setname').setDescription('Rename list (mods)').addStringOption(o => o.setName('name').setDescription('Name').setRequired(true)));
  tier.addSubcommand(s => s.setName('reset').setDescription('Clear players (mods)'));

  const ping = new SlashCommandBuilder().setName('ping').setDescription('Check latency');
  const help = new SlashCommandBuilder().setName('help').setDescription('Show commands');
  const eightball = new SlashCommandBuilder().setName('eightball').setDescription('Magic 8-ball').addStringOption(o => o.setName('question').setDescription('Q').setRequired(true));
  const roll = new SlashCommandBuilder().setName('roll').setDescription('Roll dice').addIntegerOption(o => o.setName('max').setDescription('Sides').setRequired(false).setMinValue(2).setMaxValue(1000000));
  const joke = new SlashCommandBuilder().setName('joke').setDescription('Random joke');
  const say = new SlashCommandBuilder().setName('say').setDescription('Bot echoes').addStringOption(o => o.setName('text').setDescription('Text').setRequired(true).setMaxLength(1900));
  const avatar = new SlashCommandBuilder().setName('avatar').setDescription("Show avatar").addUserOption(o => o.setName('user').setDescription('User').setRequired(false));
  const userinfo = new SlashCommandBuilder().setName('userinfo').setDescription('User info').addUserOption(o => o.setName('user').setDescription('User').setRequired(false));
  const serverinfo = new SlashCommandBuilder().setName('serverinfo').setDescription('Server info');
  const clear = new SlashCommandBuilder().setName('clear').setDescription('Delete messages (mods)').addIntegerOption(o => o.setName('amount').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100));
  const join = new SlashCommandBuilder().setName('join').setDescription('Join with an 8-digit code from an admin')
    .addStringOption(o => o.setName('code').setDescription('8-digit code').setRequired(true).setMaxLength(16));

  const mcp = new SlashCommandBuilder().setName('mcp').setDescription('MCP servers (baseUrl + optional header/auth)');
  mcp.addSubcommand(s => s.setName('panel').setDescription('Show MCP panel (mods)'));
  mcp.addSubcommand(s => s.setName('add').setDescription('Add server (mods)')
    .addStringOption(o => o.setName('name').setDescription('server-name').setRequired(true).setMaxLength(32))
    .addStringOption(o => o.setName('base_url').setDescription('https://...').setRequired(true).setMaxLength(300))
    .addStringOption(o => o.setName('headers').setDescription('Optional: {"K":"v"} or K: v').setRequired(false).setMaxLength(1000))
    .addStringOption(o => o.setName('auth').setDescription('Optional auth token').setRequired(false).setMaxLength(500)));
  mcp.addSubcommand(s => s.setName('list').setDescription('List servers'));
  mcp.addSubcommand(s => s.setName('remove').setDescription('Remove server (mods)').addStringOption(o => o.setName('name').setDescription('name').setRequired(true).setAutocomplete(true)));
  mcp.addSubcommand(s => s.setName('test').setDescription('Test connection').addStringOption(o => o.setName('name').setDescription('name').setRequired(true).setAutocomplete(true)));
  mcp.addSubcommand(s => s.setName('login').setDescription('Login on provider site, no token needed').addStringOption(o => o.setName('name').setDescription('server name (Add kora)').setRequired(true).setAutocomplete(true)));
  mcp.addSubcommand(s => s.setName('tools').setDescription('List tools').addStringOption(o => o.setName('name').setDescription('name').setRequired(true).setAutocomplete(true)));
  mcp.addSubcommand(s => s.setName('call').setDescription('Call a tool')
    .addStringOption(o => o.setName('server').setDescription('server').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('tool').setDescription('tool').setRequired(true))
    .addStringOption(o => o.setName('args').setDescription('JSON args').setRequired(false)));

  return [ai, aipanel, ainew, aiclose, connect, tier, ping, help, eightball, roll, joke, say, avatar, userinfo, serverinfo, clear, mcp, join].map(c => c.toJSON());
}

export async function registerSlash(client) {
  try {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      console.error('[slash] DISCORD_TOKEN missing — skipping slash registration');
      return;
    }
    const appId = process.env.CLIENT_ID || client.user?.id;
    if (!appId) {
      console.error('[slash] no application ID — skipping slash registration');
      return;
    }
    const rest = new REST({ version: '10' }).setToken(token);
    const body = slashDefs();
    const guildId = process.env.GUILD_ID;
    const useGuild = guildId && /^\d{17,20}$/.test(guildId);
    const coll = useGuild ? Routes.applicationGuildCommands(appId, guildId) : Routes.applicationCommands(appId);
    const one = id => useGuild ? Routes.applicationGuildCommand(appId, guildId, id) : Routes.applicationCommand(appId, id);
    // Individual upserts (no bulk PUT) so the portal's Entry Point command is preserved
    const existing = await rest.get(coll).catch(() => []);
    const byName = new Map((existing || []).map(c => [c.name, c]));
    let created = 0, updated = 0, failed = 0;
    for (const def of body) {
      try {
        const ex = byName.get(def.name);
        if (ex) { await rest.patch(one(ex.id), { body: def }); updated++; }
        else { await rest.post(coll, { body: def }); created++; }
      } catch (e) {
        failed++;
        console.error(`[slash] upsert failed for /${def.name}:`, e.message);
        // continue with remaining commands instead of aborting the whole loop
      }
    }
    console.log(`[slash] upserted ${body.length} commands (${created} new, ${updated} updated${failed ? `, ${failed} failed` : ''})${useGuild ? ` -> ${guildId}` : ' (global, may take up to 1h)'}`);
  } catch (e) {
    console.error('[slash] register failed:', e.message);
  }
}

async function aiAnswer(interaction, prompt) {
  const cmd = String(prompt || '').trim().toLowerCase();
  if (cmd === 'forget' || cmd === 'clear memory' || cmd === 'reset memory') {
    const { clearHistory } = await import('./db.js');
    const had = clearHistory(interaction.guildId, interaction.user.id);
    return interaction.reply({ content: had ? '🧠 Memory cleared! I forgot our earlier chat on this server.' : '🧠 Nothing to forget — no saved chat on this server.', ephemeral: true }).catch(() => {});
  }
  if (/^coding\s+(on|enable|off|disable|auto|smart|default|status)$/.test(cmd)) {
    const action = cmd.split(/\s+/)[1];
    if (action === 'on' || action === 'enable') {
      setCodingMode(interaction.guildId, interaction.user.id, true);
      return interaction.reply({ content: '🤖 **Coding mode ON (always)!** `/ai` can use tools — file create/read/list, zip/unzip, MCP.\nNeeds an OpenAI-compatible login (`/connect login github` works, no key). Smart mode: `/ai coding auto`.', ephemeral: true }).catch(() => {});
    }
    if (action === 'off' || action === 'disable') {
      setCodingMode(interaction.guildId, interaction.user.id, false);
      return interaction.reply({ content: '🤖 **Coding mode OFF.** Tools disabled — normal chat only.', ephemeral: true }).catch(() => {});
    }
    if (action === 'auto' || action === 'smart' || action === 'default') {
      setCodingMode(interaction.guildId, interaction.user.id, 'auto');
      return interaction.reply({ content: '🤖 **Coding mode AUTO (default).** Normal chat — files are created ONLY when the task needs them.', ephemeral: true }).catch(() => {});
    }
    const pref = getCodingPref(interaction.guildId, interaction.user.id);
    const label = pref === 'on' ? 'ON (always)' : pref === 'off' ? 'OFF' : 'AUTO (default: tools only when needed)';
    return interaction.reply({ content: `🤖 Coding mode is **${label}**. Toggle: \`/ai coding on|auto|off\`.`, ephemeral: true }).catch(() => {});
  }
  await interaction.deferReply().catch(() => {});
  const r = await askAI(String(prompt || '').slice(0, 1000), interaction.guildId, interaction.user.id);
  if (!r || !r.ok) {
    const err = r?.needAuth ? `🔒 ${r.error}\nGet a code from the admin dashboard, then run \`/join <code>\`.` : `⚠️ ${r?.error || 'AI failed!'}`;
    return interaction.editReply(sanitizeReply(err)).catch(() => {});
  }
  let t = String(r.text || '') + (r.customError ? `\n\n_(note: custom failed, used free)_` : '');
  if (r.mode === 'coding' && r.files?.length) {
    const safeFiles = r.files.map(f => `\`${String(f).slice(0, 80).replace(/[`]/g, '')}\``).join(', ');
    t += `\n\n📁 Files: ${safeFiles} — download: \`!get <path>\``;
  }
  if (t.length > 1900) t = t.slice(0, 1900) + '...';
  return interaction.editReply(sanitizeReply(t)).catch(() => {});
}

export async function handleSlash(interaction) {
  const name = interaction.commandName;
  const guild = interaction.guild;

  if (name === 'ai') return aiAnswer(interaction, interaction.options.getString('prompt', true));
  if (name === 'ping') {
    return interaction.reply(`🏓 Pong! API: **${Math.round(interaction.client.ws.ping)}ms**`).catch(() => {});
  }
  if (name === 'help') {
    const e = new EmbedBuilder().setTitle('🤖 Bot Commands').setColor(0x5865f2).setDescription(
      ['`/ai <prompt>` — Ask AI', '`/join <code>` — Join with admin code', '`/aipanel` — panel (mods)', '`/ainew` — private AI channel', '`/aiclose` — close', '`/connect status|login|code|auth|logout`', '`/mcp panel|add|list|test|tools|call` — MCP servers', '`/tier show|create|add|remove...`', '`/ping /eightball /roll /joke /say /avatar /userinfo /serverinfo /clear`', '', 'Prefix `!` / `!!` also works.'].join('\n'));
    return interaction.reply({ embeds: [e] }).catch(() => {});
  }
  if (name === 'eightball') {
    const rawQ = interaction.options.getString('question', true).slice(0, 500);
    if (hasBadMentions(rawQ)) return interaction.reply({ content: '❌ No mass mentions!', ephemeral: true }).catch(() => {});
    const q = sanitizeReply(rawQ) || '(no question)';
    const pool = Array.isArray(EIGHT_BALL_RESPONSES) && EIGHT_BALL_RESPONSES.length ? EIGHT_BALL_RESPONSES : ['Yes.'];
    const a = pool[Math.floor(Math.random() * pool.length)];
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎱 Magic 8-Ball').setColor(0x2b2d31).addFields({ name: '❓ Question', value: q.slice(0, 1024) }, { name: '💬 Answer', value: String(a).slice(0, 1024) })] }).catch(() => {});
  }
  if (name === 'roll') {
    const max = interaction.options.getInteger('max') || 6;
    return interaction.reply(`🎲 You rolled a **${Math.floor(Math.random() * max) + 1}** (out of ${max})!`).catch(() => {});
  }
  if (name === 'joke') {
    const pool = Array.isArray(JOKES) && JOKES.length ? JOKES : ['Why did the bot restart? To get to the other guild!'];
    return interaction.reply(sanitizeReply(pool[Math.floor(Math.random() * pool.length)]).slice(0, 1900)).catch(() => {});
  }
  if (name === 'say') {
    const t = interaction.options.getString('text', true).slice(0, 1900);
    if (hasBadMentions(t)) return interaction.reply({ content: '❌ No mass mentions!', ephemeral: true }).catch(() => {});
    return interaction.reply(sanitizeReply(t)).catch(() => {});
  }
  if (name === 'avatar') {
    const u = interaction.options.getUser('user') || interaction.user;
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${u.username}'s Avatar`).setImage(u.displayAvatarURL({ size: 1024 })).setColor(0x5865f2)] }).catch(() => {});
  }
  if (name === 'userinfo') {
    if (!needGuild(interaction)) return;
    const u = interaction.options.getUser('user') || interaction.user;
    let m = null;
    try { m = await guild?.members?.fetch(u.id); } catch { m = null; }
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`👤 ${u.tag}`).setThumbnail(u.displayAvatarURL()).setColor(0x5865f2)
      .addFields({ name: 'ID', value: u.id, inline: true }, { name: 'Bot?', value: u.bot ? 'yes' : 'no', inline: true },
        { name: 'Joined Server', value: m?.joinedAt ? `<t:${Math.floor(m.joinedAt.getTime() / 1000)}:R>` : 'Unknown', inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(u.createdAt.getTime() / 1000)}:R>`, inline: true })] }).catch(() => {});
  }
  if (name === 'serverinfo') {
    if (!needGuild(interaction)) return;
    const g = guild;
    const e = new EmbedBuilder().setTitle(`📊 ${g.name}`).setColor(0x5865f2)
      .addFields({ name: 'Members', value: `${g.memberCount}`, inline: true }, { name: 'Channels', value: `${g.channels.cache.size}`, inline: true },
        { name: 'Roles', value: `${g.roles.cache.size}`, inline: true }, { name: 'Created', value: `<t:${Math.floor(g.createdAt.getTime() / 1000)}:R>`, inline: true }, { name: 'Owner', value: `<@${g.ownerId}>`, inline: true });
    const icon = g.iconURL();
    if (icon) e.setThumbnail(icon);
    return interaction.reply({ embeds: [e] }).catch(() => {});
  }
  if (name === 'clear') {
    if (!modOnly(interaction)) return;
    const amount = interaction.options.getInteger('amount', true);
    try {
      const del = await interaction.channel.bulkDelete(amount, true);
      return interaction.reply({ content: `🧹 Deleted **${del.size}** messages!`, ephemeral: true }).catch(() => {});
    } catch { return interaction.reply({ content: "Couldn't delete (older than 14 days?)", ephemeral: true }).catch(() => {}); }
  }
  if (name === 'aipanel') {
    if (!modOnly(interaction)) return;
    await interaction.channel.send(buildPanel('!')).catch(() => {});
    return interaction.reply({ content: '✅ Panel posted!', ephemeral: true }).catch(() => {});
  }
  if (name === 'ainew') {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    try {
      const ch = await createSessionChannel(guild, interaction.user);
      return interaction.editReply({ content: `✅ Your private AI channel: <#${ch.id}>` }).catch(() => {});
    } catch (e) { return interaction.editReply({ content: `❌ ${e.message}` }).catch(() => {}); }
  }
  if (name === 'aiclose') {
    const sess = getAISession(interaction.channelId);
    if (!sess) return interaction.reply({ content: '❌ Eta AI chat channel na!', ephemeral: true }).catch(() => {});
    const ok = sess.user_id === interaction.user.id || interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages);
    if (!ok) return interaction.reply({ content: '❌ Sudhu owner / mod!', ephemeral: true }).catch(() => {});
    await interaction.reply({ content: '🗑️ Closing in 3s...' }).catch(() => {});
    deleteAISession(interaction.channelId);
    setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
    return;
  }

  if (name === 'connect') {
    if (!needGuild(interaction)) return;
    const sub = interaction.options.getSubcommand();
    const gid = interaction.guildId, uid = interaction.user.id;
    if (sub === 'status') {
      const cfg = getAIConfig(gid), full = getAIConfigFull(gid), my = getUserKey(gid, uid);
      const need = isAuthRequired() && cfg.mode !== 'custom' && !my;
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔌 AI Status').setColor(0x5865f2).addFields(
        { name: 'Server', value: cfg.mode === 'custom' ? `**${cfg.provider}**` : 'free', inline: true },
        { name: 'Your login', value: my ? `✅ ${my.provider} (${maskKey(my.api_key)})` : '❌ `/connect login`', inline: true },
        { name: 'Model', value: `\`${my?.model || full.model || 'default'}\``, inline: true },
        { name: 'Auth needed?', value: need ? 'yes' : 'no', inline: true },
        { name: 'Unlocked', value: `${countAuthorized(gid)} users`, inline: true })], ephemeral: true }).catch(() => {});
    }
    if (sub === 'login') {
      const which = (interaction.options.getString('provider') || 'openrouter').toLowerCase();
      if (which === 'google' || which === 'gemini') {
        const g = startGoogleLogin(gid, uid);
        if (!g.ok) return interaction.reply({ content: `❌ ${g.error}`, ephemeral: true }).catch(() => {});
        return interaction.reply({
          content: `🔌 **Connect with Google**\n**1.** Open and sign in:\n${g.url}\n**2.** Approve — connected automatically, nothing to paste! _(10 min link)_`,
          ephemeral: true,
        }).catch(() => {});
      }
      if (which === 'huggingface' || which === 'hf') {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const d = await startHFDevice();
        if (!d.ok) return interaction.editReply(`❌ ${d.error}`).catch(() => {});
        await interaction.editReply(`🔑 **Hugging Face login**\n**1.** Open: ${d.url}\n**2.** Enter this code: \`${d.userCode}\`\n**3.** Authorize — I'll detect it automatically (waiting up to 5 min)...`).catch(() => {});
        pollHFDevice(d.deviceCode, d.interval).then(r => {
          if (!r.ok) return interaction.followUp({ content: `❌ HF login: ${r.error}`, ephemeral: true }).catch(() => {});
          const model = saveHFLogin(gid, uid, r.token);
          interaction.followUp({ content: `✅ Connected via **Hugging Face**! Model: \`${model}\``, ephemeral: true }).catch(() => {});
        }).catch(() => {});
        return;
      }
      if (which === 'github' || which === 'gh') {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const d = await startGitHubDevice();
        if (!d.ok) return interaction.editReply(`❌ ${d.error}`).catch(() => {});
        await interaction.editReply(`🔑 **GitHub login**\n**1.** Open: ${d.url}\n**2.** Enter this code: \`${d.userCode}\`\n**3.** Authorize — I'll detect it automatically (waiting up to 5 min)...`).catch(() => {});
        pollGitHubDevice(d.deviceCode, d.interval).then(r => {
          if (!r.ok) return interaction.followUp({ content: `❌ GitHub login: ${r.error}`, ephemeral: true }).catch(() => {});
          const model = saveGitHubLogin(gid, uid, r.token);
          interaction.followUp({ content: `✅ Connected via **GitHub Models**! Model: \`${model}\``, ephemeral: true }).catch(() => {});
        }).catch(() => {});
        return;
      }
      const { url } = createLogin(gid, uid);
      return interaction.reply({ content: `**1.** Open + log in:\n${url}\n**2.** Copy the code and paste it into \`/connect code\` (10 min)!`, ephemeral: true }).catch(() => {});
    }
    if (sub === 'code') {
      const code = interaction.options.getString('code', true);
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const r = await exchangeCode(gid, uid, code);
      return interaction.editReply(r.ok ? `✅ Connected! Model: \`${r.model}\`` : `❌ ${r.error}`).catch(() => {});
    }
    if (sub === 'auth') {
      const { timingSafeEqual } = await import('node:crypto');
      const code = interaction.options.getString('code', true).replace(/\s/g, '').slice(0, 128);
      const exp = String(process.env.AI_AUTH_CODE || '').trim();
      if (!exp) {
        // Fail-closed when join-code gating is on; only auto-unlock in true free mode.
        if (String(process.env.REQUIRE_JOIN_CODE || '').toLowerCase() === 'true') {
          return interaction.reply({ content: '🔒 AI is locked! Ask an admin for a join code, then `/join <code>`.', ephemeral: true }).catch(() => {});
        }
        authorizeUser(gid, uid); return interaction.reply({ content: '✅ Free mode — unlocked!', ephemeral: true }).catch(() => {});
      }
      const ok = code.length === exp.length && timingSafeEqual(Buffer.from(code), Buffer.from(exp));
      if (!ok) return interaction.reply({ content: '❌ Wrong code!', ephemeral: true }).catch(() => {});
      authorizeUser(gid, uid);
      return interaction.reply({ content: '✅ Connected! Use `/ai`.', ephemeral: true }).catch(() => {});
    }
    if (sub === 'logout') {
      const { clearHistory } = await import('./db.js');
      const a = revokeUser(gid, uid), b = clearUserKey(gid, uid);
      clearHistory(gid, uid);
      return interaction.reply({ content: a || b ? '👋 Logged out.' : 'ℹ️ Not connected.', ephemeral: true }).catch(() => {});
    }
    if (sub === 'test') {
      if (!needGuild(interaction)) return;
      const q = interaction.options.getString('question') || 'Say OK';
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const { askCustomAI: t } = await import('./ai.js');
      const my = getUserKey(gid, uid), cfg = getAIConfigFull(gid);
      const src = my ? { baseUrl: my.base_url, apiKey: my.api_key, model: my.model, provider: my.provider } : (cfg.mode === 'custom' ? { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, provider: cfg.provider } : null);
      if (!src) return interaction.editReply('⚠️ No login/custom AI! `/connect login` first.').catch(() => {});
      const r = await t(q.slice(0, 300), src);
      return interaction.editReply(r?.ok ? `✅ Works: ${sanitizeReply(String(r.text || '').slice(0, 1500))}` : `❌ ${sanitizeReply(r?.error || 'Test failed')}`).catch(() => {});
    }
    if (sub === 'free') {
      if (!modOnly(interaction)) return;
      clearAIConfig(gid);
      return interaction.reply({ content: '✅ Free mode.', ephemeral: true }).catch(() => {});
    }
    if (sub === 'model') {
      const name = interaction.options.getString('name', true);
      const { isValidModelName } = await import('./models.js');
      const clean = isValidModelName(name);
      if (!clean) return interaction.reply({ content: '❌ Invalid model name! Pick one from `/connect models`.', ephemeral: true }).catch(() => {});
      if (getUserKey(gid, uid)?.api_key) {
        const { setUserModel } = await import('./db.js');
        setUserModel(gid, uid, clean);
        return interaction.reply({ content: `✅ Your model set to \`${clean}\``, ephemeral: true }).catch(() => {});
      }
      if (!modOnly(interaction)) return;
      const ok = setAIModel(gid, clean);
      return interaction.reply({ content: ok ? '✅ Model set.' : '⚠️ No custom AI yet!', ephemeral: true }).catch(() => {});
    }
    if (sub === 'models') {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const { formatFreeModels } = await import('./models.js');
      const f = await formatFreeModels(interaction.options.getString('search') || '', 15);
      const body = f.lines.length ? f.lines.join('\n') : 'No matches! Try another search.';
      return interaction.editReply(`🆓 **Free OpenRouter models** (${f.total} found${f.live ? '' : ', cached list — API offline'}):\n${body}\n\nSet one: \`/connect model <pick from the dropdown>\``.slice(0, 1900)).catch(() => {});
    }
    if (sub === 'key' || sub === 'api') {
      if (!modOnly(interaction)) return;
      let v;
      if (sub === 'key') {
        const p = interaction.options.getString('provider', true);
        v = validateProviderInput(p, interaction.options.getString('key', true), interaction.options.getString('model') || '');
      } else {
        v = validateCustomInput(interaction.options.getString('base_url', true), interaction.options.getString('key', true), interaction.options.getString('model') || 'gpt-3.5-turbo');
      }
      if (v.error) return interaction.reply({ content: `❌ ${v.error}`, ephemeral: true }).catch(() => {});
      setAICustom(gid, v.base, v.key, v.model, v.provider || 'custom');
      return interaction.reply({ content: `✅ Connected! Model \`${v.model}\` Key \`${maskKey(v.key)}\``, ephemeral: true }).catch(() => {});
    }
  }

  if (name === 'tier') {
    if (!needGuild(interaction)) return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'show') {
      const rows = getTierRows(gid0(interaction)).slice(0, 25);
      const players = getPlayers(gid0(interaction));
      const e = new EmbedBuilder().setTitle(`🏆 ${getTierName(gid0(interaction))}`).setColor(0x5865f2).setFooter({ text: `Total: ${players.length}` });
      rows.forEach(r => {
        const list = sanitizeReply(players.filter(p => p.tier === r.tier).map(p => `• ${p.player}`).join('\n')).slice(0, 950) || '_empty_';
        e.addFields({ name: `${r.emoji || '•'} ${r.tier}`.slice(0, 256), value: list });
      });
      return interaction.reply({ embeds: [e] }).catch(() => {});
    }
    if (!modOnly(interaction)) return;
    const g = gid0(interaction);
    if (sub === 'create') {
      const t = interaction.options.getString('name', true).toUpperCase();
      if (!/^[A-Z0-9+\-]{1,10}$/.test(t)) return interaction.reply({ content: '❌ Invalid name!', ephemeral: true }).catch(() => {});
      if (getTierRows(g).length >= 20) return interaction.reply({ content: '❌ Max 20 tiers!', ephemeral: true }).catch(() => {});
      return interaction.reply({ content: createTier(g, t) ? `✅ Created **${t}**!` : '⚠️ Exists!', ephemeral: true }).catch(() => {});
    }
    if (sub === 'delete') {
      const r = deleteTier(g, interaction.options.getString('name', true).toUpperCase());
      return interaction.reply({ content: r === null ? '⚠️ Not found!' : r === 'last' ? '❌ Last tier!' : `🗑️ Deleted!`, ephemeral: true }).catch(() => {});
    }
    if (sub === 'add') {
      const player = interaction.options.getString('player', true);
      if (hasBadMentions(player)) return interaction.reply({ content: '❌ No @everyone / @here / role mentions!', ephemeral: true }).catch(() => {});
      const ok = addPlayer(g, interaction.options.getString('tier', true).toUpperCase(), player);
      return interaction.reply({ content: ok ? '✅ Added!' : '❌ Tier not found!', ephemeral: true }).catch(() => {});
    }
    if (sub === 'remove') {
      const ok = removePlayer(g, interaction.options.getString('tier', true).toUpperCase(), interaction.options.getString('player', true));
      return interaction.reply({ content: ok ? '🗑️ Removed!' : '⚠️ Not found!', ephemeral: true }).catch(() => {});
    }
    if (sub === 'emoji') {
      const em = interaction.options.getString('emoji', true);
      // reuse prefix-side validation: short emoji / custom :name: / clear
      if (hasBadMentions(em) || em.length > 20) return interaction.reply({ content: '❌ Invalid emoji!', ephemeral: true }).catch(() => {});
      const ok = setTierEmoji(g, interaction.options.getString('tier', true).toUpperCase(), em);
      return interaction.reply({ content: ok ? '✅ Set!' : '⚠️ Not found!', ephemeral: true }).catch(() => {});
    }
    if (sub === 'setname') {
      const nm = interaction.options.getString('name', true);
      if (hasBadMentions(nm)) return interaction.reply({ content: '❌ No @everyone / @here / role mentions!', ephemeral: true }).catch(() => {});
      setTierName(g, nm);
      return interaction.reply({ content: '✏️ Renamed!', ephemeral: true }).catch(() => {});
    }
    if (sub === 'reset') { resetTierList(g); return interaction.reply({ content: '🔄 Reset!', ephemeral: true }).catch(() => {}); }
  }

  if (name === 'mcp') {
    if (!needGuild(interaction)) return;
    const sub = interaction.options.getSubcommand();
    const gid = interaction.guildId;
    if (sub === 'panel') {
      if (!modOnly(interaction)) return;
      await interaction.channel.send(buildMcpPanel()).catch(() => {});
      return interaction.reply({ content: '✅ MCP panel posted!', ephemeral: true }).catch(() => {});
    }
    if (sub === 'list') {
      const rows = listMcpServers(gid);
      if (!rows.length) return interaction.reply({ content: '📋 Kono MCP server nei!', ephemeral: true }).catch(() => {});
      return interaction.reply({ content: `📋 MCP:\n${rows.map(r => `• **${r.name}** — \`${r.base_url}\`${r.hasAuth ? ` (auth set)` : ''}`).join('\n').slice(0, 1800)}`, ephemeral: true }).catch(() => {});
    }
    if (sub === 'add') {
      if (!modOnly(interaction)) return;
      const mcpName = interaction.options.getString('name', true).toLowerCase();
      const base = normalizeMcpUrl(interaction.options.getString('base_url', true));
      const headers = interaction.options.getString('headers') || null;
      const auth = interaction.options.getString('auth') || null;
      if (!validMcpName(mcpName)) return interaction.reply({ content: '❌ Invalid name!', ephemeral: true }).catch(() => {});
      if (!base) return interaction.reply({ content: '❌ Invalid base URL!', ephemeral: true }).catch(() => {});
      const p = parseHeaders(headers);
      if (!p.ok) return interaction.reply({ content: `❌ ${p.error}`, ephemeral: true }).catch(() => {});
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const t = await testMcpServer(base, headers, auth);
      upsertMcpServer(gid, mcpName, base, headers, auth);
      return interaction.editReply({ content: t.ok ? `✅ **${mcpName}** saved! OK.` : `⚠️ **${mcpName}** saved, test fail: ${t.error}` }).catch(() => {});
    }
    if (sub === 'remove') {
      if (!modOnly(interaction)) return;
      const ok = deleteMcpServer(gid, interaction.options.getString('name', true));
      return interaction.reply({ content: ok ? '🗑️ Deleted!' : '⚠️ Not found!', ephemeral: true }).catch(() => {});
    }
    if (sub === 'test') {
      if (!modOnly(interaction)) return;
      const s = getMcpServer(gid, interaction.options.getString('name', true));
      if (!s) return interaction.reply({ content: '⚠️ Not found!', ephemeral: true }).catch(() => {});
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const t = await testMcpServer(s.base_url, s.headers, s.auth);
      return interaction.editReply(t.ok ? `✅ **${s.name}** OK!` : `❌ ${sanitizeReply(t.error)}`).catch(() => {});
    }
    if (sub === 'login') {
      if (!modOnly(interaction)) return;
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const r = await startMcpLogin(gid, interaction.options.getString('name', true));
      if (!r.ok) return interaction.editReply(`❌ ${sanitizeReply(r.error)}`).catch(() => {});
      return interaction.editReply(`🔑 **Login link (valid 10 min):**\n${r.url}\n\n1. Open the link and log in\n2. After authorize it connects automatically!`).catch(() => {});
    }
    if (sub === 'tools') {
      if (!modOnly(interaction)) return;
      const s = getMcpServer(gid, interaction.options.getString('name', true));
      if (!s) return interaction.reply({ content: '⚠️ Not found!', ephemeral: true }).catch(() => {});
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const t = await listMcpTools(s);
      if (!t.ok) return interaction.editReply(`❌ ${sanitizeReply(t.error)}`).catch(() => {});
      if (!t.tools.length) return interaction.editReply('🛠️ No tools!').catch(() => {});
      return interaction.editReply(sanitizeReply(`🛠️ **${s.name}**:\n${t.tools.map(x => `• **${x.name}** — ${x.description || ''}`).join('\n').slice(0, 1800)}`)).catch(() => {});
    }
    if (sub === 'call') {
      if (!modOnly(interaction)) return;
      const s = getMcpServer(gid, interaction.options.getString('server', true));
      if (!s) return interaction.reply({ content: '⚠️ Server not found!', ephemeral: true }).catch(() => {});
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const r = await callMcpTool(s, interaction.options.getString('tool', true), interaction.options.getString('args') || '');
      return interaction.editReply(r.ok ? sanitizeReply(`🛠️ Result:\n${r.text}`).slice(0, 1900) : `❌ ${sanitizeReply(r.error)}`).catch(() => {});
    }
  }

  if (name === 'join') {
    if (!needGuild(interaction)) return;
    if (joinRateLimited(interaction.user.id)) {
      return interaction.reply({ content: '⏳ Too many tries! Wait 5 minutes.', ephemeral: true }).catch(() => {});
    }
    // prune joinHits to avoid unbounded growth
    if (joinHits.size > 2000) {
      const now = Date.now();
      for (const [k, arr] of joinHits) {
        const recent = arr.filter(t => now - t < 5 * 60 * 1000);
        if (!recent.length) joinHits.delete(k); else joinHits.set(k, recent);
      }
    }
    const r = redeemJoinCode(interaction.options.getString('code', true), interaction.guildId, interaction.user.id);
    if (!r.ok) return interaction.reply({ content: `❌ ${r.error}`, ephemeral: true }).catch(() => {});
    if (r.role === 'admin') {
      return interaction.reply({ content: '✅ Joined as **ADMIN**! AI unlocked + bot management allowed.', ephemeral: true }).catch(() => {});
    }
    return interaction.reply({ content: '✅ Joined! You can now use `/ai`.', ephemeral: true }).catch(() => {});
  }
}

function gid0(i) { return i.guildId; }

// Autocomplete: saved MCP server names + free OpenRouter models for /connect model
export async function handleAutocomplete(interaction) {
  try {
    if (interaction.commandName === 'connect') {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== 'name') return interaction.respond([]);
      const { searchFreeModels } = await import('./models.js');
      await interaction.respond(await searchFreeModels(focused.value || '', 25));
      return;
    }
    if (interaction.commandName !== 'mcp') return interaction.respond([]);
    const focusedMcp = interaction.options.getFocused(true);
    if (focusedMcp.name !== 'name' && focusedMcp.name !== 'server') return interaction.respond([]);
    const q = String(focusedMcp.value || '').toLowerCase();
    const rows = listMcpServers(interaction.guildId)
      .filter(r => r.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map(r => ({ name: `${r.name} — ${r.base_url}`.slice(0, 100), value: r.name }));
    await interaction.respond(rows);
  } catch {
    try { await interaction.respond([]); } catch { /* ignore */ }
  }
}
export function isValidGuildRef() { return isValidGuildId; }
