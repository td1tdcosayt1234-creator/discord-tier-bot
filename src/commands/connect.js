import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { timingSafeEqual } from 'node:crypto';
import {
  getAIConfig, getAIConfigFull, setAICustom, setAIModel, clearAIConfig,
  authorizeUser, revokeUser, isUserAuthorized, countAuthorized,
  getUserKey, clearUserKey, isBotAdmin, clearHistory,
} from '../db.js';
import { isAuthRequired, maskKey, validateCustomInput, validateProviderInput, askCustomAI, AI_PROVIDERS } from '../ai.js';
import { createLogin, exchangeCode, startHFDevice, pollHFDevice, saveHFLogin, hfConfigured, startGoogleLogin, startGitHubDevice, pollGitHubDevice, saveGitHubLogin } from '../oauth.js';

function isMod(member) {
  if (!member?.permissions) return false;
  return member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    || member.permissions.has(PermissionsBitField.Flags.ManageMessages);
}

// Mods + users joined with an admin code
function canManage(message) {
  if (isMod(message.member)) return true;
  return isBotAdmin(message.guild.id, message.author.id);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

const attempts = new Map();
function hitRateLimit(userId) {
  const now = Date.now();
  const arr = (attempts.get(userId) || []).filter(t => now - t < 5 * 60 * 1000);
  arr.push(now);
  attempts.set(userId, arr);
  return arr.length > 5;
}

function usage(prefix) {
  const plist = Object.keys(AI_PROVIDERS).join(' | ');
  return [
    `**No key needed (browser/device login):**`,
    `\`${prefix}connect login [openrouter|google|huggingface|github]\` — log in on the site, no key (default: openrouter)`,
    `\`${prefix}connect models [search]\` — list free OpenRouter models`,
    `\`${prefix}connect model <id>\` — set your model from the free list`,
    `\`${prefix}connect code <CODE>\` — paste the OpenRouter code to connect!`,
    ``,
    `**1) Auth code** (free AI, owner gives code):`,
    `\`${prefix}connect auth <CODE>\` — unlock AI for yourself`,
    ``,
    `**2) Platform key** (mods, connect with that platform's key):`,
    `\`${prefix}connect gemini <API_KEY> [model]\` — key: https://aistudio.google.com/apikey`,
    `\`${prefix}connect openai | groq | openrouter | deepseek <KEY> [model]\``,
    `\`${prefix}connect huggingface | xai | cerebras | fireworks <KEY> [model]\``,
    `\`${prefix}connect together | mistral | github-models <KEY> [model]\``,
    `\`${prefix}connect api <BASE_URL> <KEY> [model]\` — custom URL`,
    ``,
    `\`${prefix}connect test <q>\` — test current endpoint`,
    `\`${prefix}connect status\` — show mode + provider`,
    `\`${prefix}connect free\` — back to free`,
    `\`${prefix}connect logout\` — remove your auth`,
    ``,
    `_Providers: ${plist}_`,
  ].join('\n');
}

export default {
  name: 'connect',
  async execute(message, args, client, PREFIX) {
    const prefix = message.content.startsWith('!!') ? '!!' : PREFIX;
    const sub = (args[0] || 'help').toLowerCase();
    const guildId = message.guild.id;
    const userId = message.author.id;

    if (sub === 'help' || sub === 'h') {
      const embed = new EmbedBuilder()
        .setTitle('🔌 AI Connect')
        .setColor(0x5865f2)
        .setDescription(usage(prefix))
        .setFooter({ text: 'Both !connect and !!connect work' });
      return message.reply({ embeds: [embed] });
    }

    if (sub === 'status') {
      const cfg = getAIConfig(guildId);
      const full = getAIConfigFull(guildId);
      const myKey = getUserKey(guildId, userId);
      const authed = isUserAuthorized(guildId, userId);
      const authNeeded = isAuthRequired() && cfg.mode !== 'custom' && !myKey;
      const embed = new EmbedBuilder()
        .setTitle('🔌 AI Status')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Server mode', value: cfg.mode === 'custom' ? `**${cfg.provider || 'custom'}** → \`${cfg.baseUrl}\`` : 'free (no key)', inline: false },
          { name: 'Your login', value: myKey ? `✅ **${myKey.provider}** connected (${maskKey(myKey.api_key)})` : '❌ not logged in — `!!connect login`', inline: false },
          ...(cfg.mode === 'custom'
            ? [
                { name: 'Provider', value: `\`${full.provider || 'custom'}\``, inline: true },
                { name: 'Model', value: `\`${full.model || 'default'}\``, inline: true },
                { name: 'Key', value: full.apiKey ? `${maskKey(full.apiKey)} (set)` : 'missing!', inline: true },
              ]
            : []),
          { name: 'Auth code required?', value: authNeeded ? 'yes — `!!connect auth <CODE>`' : 'no', inline: true },
          { name: 'You unlocked?', value: authed ? '✅ yes' : (authNeeded ? '❌ no' : 'n/a (free mode)'), inline: true },
          { name: 'Unlocked users', value: `${countAuthorized(guildId)}`, inline: true },
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (sub === 'login') {
      const which = (args[1] || 'openrouter').toLowerCase();
      if (which === 'google' || which === 'gemini') {
        const g = startGoogleLogin(guildId, userId);
        if (!g.ok) return message.reply(`❌ ${g.error}`).catch(() => {});
        const embed = new EmbedBuilder()
          .setTitle('🔌 Connect with Google — no API key needed!')
          .setColor(0x5865f2)
          .setDescription([
            `**1.** Open this link and sign in with Google:`,
            `${g.url}`,
            ``,
            `**2.** Approve access — you're connected automatically, nothing to paste!`,
            ``,
            `_Link valid 10 min. Uses Gemini (\`gemini-2.0-flash\`), token auto-refreshes._`,
          ].join('\n'));
        return message.reply({ embeds: [embed] });
      }
      if (which === 'huggingface' || which === 'hf') {
        const thinking = await message.reply('🔑 Starting Hugging Face login...').catch(() => null);
        const d = await startHFDevice();
        if (!d.ok) {
          if (thinking) return thinking.edit(`❌ ${d.error}`).catch(() => {});
          return message.reply(`❌ ${d.error}`).catch(() => {});
        }
        const txt = `🔑 **Hugging Face login**\n**1.** Open: ${d.url}\n**2.** Enter this code: \`${d.userCode}\`\n**3.** Authorize — I'll detect it automatically (waiting up to 5 min)...`;
        if (thinking) await thinking.edit(txt).catch(() => {});
        else await message.reply(txt).catch(() => {});
        pollHFDevice(d.deviceCode, d.interval).then(r => {
          if (!r.ok) return message.channel.send(`❌ <@${userId}> HF login: ${r.error}`).catch(() => {});
          const model = saveHFLogin(guildId, userId, r.token);
          message.channel.send(`✅ <@${userId}> connected via **Hugging Face**! Model: \`${model}\` — try \`!ai hello\`.`).catch(() => {});
        }).catch(() => {});
        return;
      }
      if (which === 'github' || which === 'gh') {
        const thinking = await message.reply('🔑 Starting GitHub login...').catch(() => null);
        const d = await startGitHubDevice();
        if (!d.ok) {
          if (thinking) return thinking.edit(`❌ ${d.error}`).catch(() => {});
          return message.reply(`❌ ${d.error}`).catch(() => {});
        }
        const txt = `🔑 **GitHub login**\n**1.** Open: ${d.url}\n**2.** Enter this code: \`${d.userCode}\`\n**3.** Authorize — I'll detect it automatically (waiting up to 5 min)...`;
        if (thinking) await thinking.edit(txt).catch(() => {});
        else await message.reply(txt).catch(() => {});
        pollGitHubDevice(d.deviceCode, d.interval).then(r => {
          if (!r.ok) return message.channel.send(`❌ <@${userId}> GitHub login: ${r.error}`).catch(() => {});
          const model = saveGitHubLogin(guildId, userId, r.token);
          message.channel.send(`✅ <@${userId}> connected via **GitHub Models**! Model: \`${model}\` — try \`!ai hello\`.`).catch(() => {});
        }).catch(() => {});
        return;
      }
      if (which !== 'openrouter' && which !== 'or') {
        return message.reply(`❌ Unknown login provider! Try \`${prefix}connect login\`, \`${prefix}connect login google\`, \`${prefix}connect login huggingface\` or \`${prefix}connect login github\``);
      }
      const { url } = createLogin(guildId, userId);
      const embed = new EmbedBuilder()
        .setTitle('🔌 Connect AI — no API key needed!')
        .setColor(0x5865f2)
        .setDescription([
          `**1.** Open this link and log in / sign up on OpenRouter (1-click with Google):`,
          `${url}`,
          ``,
          `**2.** After authorize it shows a **code** — copy it`,
          `**3.** Back in Discord: \`${prefix}connect code <CODE>\``,
          ``,
          `_Use the code within 10 min. Unlocks 400+ free/paid models including Gemini._`,
        ].join('\n'));
      return message.reply({ embeds: [embed] });
    }

    if (sub === 'code' || sub === 'verify' || sub === 'callback') {
      const code = args.slice(1).join('').trim();
      message.delete().catch(() => {});
      if (!code) return message.channel.send(`❌ Usage: \`${prefix}connect code <CODE>\` — first run \`${prefix}connect login\`!`);
      const thinking = await message.channel.send('🔌 Connecting...');
      const r = await exchangeCode(guildId, userId, code);
      if (!r.ok) return thinking.edit(`❌ ${r.error}`);
      return thinking.edit(`✅ Connected! <@${userId}> can now use \`!ai <question>\` (model: \`${r.model}\`). Key message deleted.`);
    }

    if (sub === 'auth') {
      const code = args.slice(1).join('').trim();
      message.delete().catch(() => {});
      if (!code) return message.channel.send(`❌ Usage: \`${prefix}connect auth <CODE>\` (ask the bot owner for the code)`);
      if (hitRateLimit(userId)) return message.channel.send('⏳ Too many tries! Wait 5 minutes.');
      const expected = String(process.env.AI_AUTH_CODE || '').trim();
      if (!expected) {
        authorizeUser(guildId, userId);
        return message.channel.send('✅ Free mode is on — no code needed. You can use `!ai` right away!');
      }
      if (!safeEqual(code, expected)) return message.channel.send('❌ Wrong code! Ask the owner for the correct `AI_AUTH_CODE`.');
      authorizeUser(guildId, userId);
      return message.channel.send(`✅ <@${userId}> connected! You can now use \`!ai <question>\`.`);
    }

    // provider shortcuts: !!connect gemini <KEY> [model]
    if (AI_PROVIDERS[sub]) {
      if (!canManage(message)) return message.reply('❌ Mods only! You need **Manage Messages** or **Manage Server**.');
      const [apiKey, ...modelParts] = args.slice(1);
      if (!apiKey) {
        const p = AI_PROVIDERS[sub];
        return message.reply(`❌ Usage: \`${prefix}connect ${sub} <API_KEY> [model]\`\nGet key: ${p.keyUrl}\nDefault model: \`${p.defaultModel}\`\nExample: \`${prefix}connect ${sub} ${p.hint.split(' ')[0]} \``);
      }
      const v = validateProviderInput(sub, apiKey, modelParts.join(' '));
      if (v.error) return message.reply(`❌ ${v.error}`);
      setAICustom(guildId, v.base, v.key, v.model, v.provider);
      message.delete().catch(() => {});
      return message.channel.send(`✅ **${v.label}** connected!\n• Model: \`${v.model}\`\n• Key: \`${maskKey(v.key)}\`\nTry \`!ai hello\` — *key message deleted for safety.*`);
    }

    if (sub === 'api') {
      if (!canManage(message)) return message.reply('❌ Mods only! You need **Manage Messages** or **Manage Server**.');
      const [baseUrl, apiKey, ...modelParts] = args.slice(1);
      if (!baseUrl || !apiKey) {
        return message.reply(`❌ Usage: \`${prefix}connect api <BASE_URL> <API_KEY> [model]\`\nExample: \`${prefix}connect api https://api.openai.com/v1 sk-abc123 gpt-4o-mini\``);
      }
      const v = validateCustomInput(baseUrl, apiKey, modelParts.join(' ') || 'gpt-3.5-turbo');
      if (v.error) return message.reply(`❌ ${v.error}`);
      setAICustom(guildId, v.base, v.key, v.model, 'custom');
      message.delete().catch(() => {});
      return message.channel.send(`✅ Custom AI connected!\n• URL: \`${v.base}\`\n• Model: \`${v.model}\`\n• Key: \`${maskKey(v.key)}\`\nTry \`!ai hello\``);
    }

    if (sub === 'models') {
      const q = args.slice(1).join(' ').trim().slice(0, 80);
      const { formatFreeModels } = await import('../models.js');
      const f = await formatFreeModels(q, 15);
      const body = f.lines.length ? f.lines.join('\n') : 'No matches! Try another search.';
      const txt = `🆓 **Free OpenRouter models** (${f.total} found${f.live ? '' : ', cached list — API offline'}):\n${body}\n\nSet one: \`${prefix}connect model <id>\``;
      return message.reply(txt.slice(0, 1900)).catch(() => {});
    }

    if (sub === 'model') {
      const { isValidModelName } = await import('../models.js');
      const clean = isValidModelName(args.slice(1).join(' '));
      if (!clean) return message.reply(`❌ Usage: \`${prefix}connect model <name>\` — see \`${prefix}connect models\` for the free list!`);
      if (getUserKey(guildId, userId)?.api_key) {
        const { setUserModel } = await import('../db.js');
        setUserModel(guildId, userId, clean);
        return message.reply(`✅ Your model set to \`${clean}\``);
      }
      if (!canManage(message)) return message.reply('❌ Mods only! (for yourself use `!!connect login` first, then set your model)');
      const ok = setAIModel(guildId, clean);
      if (!ok) return message.reply(`⚠️ No custom AI set yet! First: \`${prefix}connect gemini <KEY>\` or \`${prefix}connect api ...\``);
      return message.reply(`✅ Model set to \`${clean}\``);
    }

    if (sub === 'test') {
      const myKey = getUserKey(guildId, userId);
      if (myKey?.api_key) {
        const q = args.slice(1).join(' ').trim() || 'Say OK';
        const thinking = await message.reply('🔌 Testing your login...');
        const r = await askCustomAI(q.slice(0, 300), { baseUrl: myKey.base_url, apiKey: myKey.api_key, model: myKey.model, provider: myKey.provider });
        if (r.ok) return thinking.edit(`✅ Your login works! Reply: ${r.text.slice(0, 1500)}`);
        return thinking.edit(`❌ Your login failed: ${r.error}`);
      }
      if (!canManage(message)) return message.reply('❌ Mods only! (for yourself use `!!connect login`)');
      const cfg = getAIConfigFull(guildId);
      if (cfg.mode !== 'custom' || !cfg.baseUrl || !cfg.apiKey) {
        return message.reply(`⚠️ No custom AI configured! Use \`${prefix}connect gemini <KEY>\` first.`);
      }
      const q = args.slice(1).join(' ').trim() || 'Say OK';
      const thinking = await message.reply('🔌 Testing...');
      const r = await askCustomAI(q.slice(0, 300), { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, provider: cfg.provider });
      if (r.ok) return thinking.edit(`✅ Works! Reply: ${r.text.slice(0, 1500)}`);
      return thinking.edit(`❌ Failed: ${r.error}`);
    }

    if (sub === 'free') {
      if (!canManage(message)) return message.reply('❌ Mods only!');
      clearAIConfig(guildId);
      return message.reply('✅ Switched back to **free AI** (custom endpoint removed).');
    }

    if (sub === 'disconnect' || sub === 'revoke') {
      const target = message.mentions.users.first();
      if (target) {
        if (!canManage(message)) return message.reply('❌ Mods only!');
        revokeUser(guildId, target.id);
        clearUserKey(guildId, target.id);
        return message.reply(`🗑️ Revoked AI access for <@${target.id}>`);
      }
      if (args[1] && canManage(message) && args[1].toLowerCase() === 'all') {
        clearAIConfig(guildId);
        return message.reply('🗑️ Custom AI config removed for this server.');
      }
      const removed = revokeUser(guildId, userId);
      const removedKey = clearUserKey(guildId, userId);
      if (canManage(message)) {
        clearAIConfig(guildId);
        return message.reply(`🗑️ Custom AI removed${removed || removedKey ? ' + your login revoked' : ''}. Now on free mode.`);
      }
      return message.reply(removed || removedKey ? '🗑️ Your AI login/auth was removed.' : 'ℹ️ You had no auth saved.');
    }

    if (sub === 'logout') {
      const removed = revokeUser(guildId, userId);
      const removedKey = clearUserKey(guildId, userId);
      clearHistory(guildId, userId);
      return message.reply(removed || removedKey ? '👋 Logged out from AI (login + auth + chat memory cleared).' : 'ℹ️ You were not connected.');
    }

    return message.reply(`❓ Unknown! Try:\n${usage(prefix)}`);
  },
};
