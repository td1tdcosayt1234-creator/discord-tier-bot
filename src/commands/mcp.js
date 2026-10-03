import { PermissionsBitField } from 'discord.js';
import { upsertMcpServer, listMcpServers, getMcpServer, deleteMcpServer, isBotAdmin } from '../db.js';
import { normalizeMcpUrl, validMcpName, parseHeaders, testMcpServer, listMcpTools, callMcpTool, maskAuth } from '../mcp.js';
import { startMcpLogin } from '../mcpAuth.js';
import { postMcpPanel } from '../mcpPanel.js';

function needsMod(member) {
  return member?.permissions?.has(PermissionsBitField.Flags.ManageMessages)
    || member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
}

// Mods + users joined with an admin code
function canManage(message) {
  if (needsMod(message.member)) return true;
  return isBotAdmin(message.guild.id, message.author.id);
}

export default {
  name: 'mcp',
  async execute(message, args, client, PREFIX) {
    const sub = (args[0] || 'panel').toLowerCase();
    const gid = message.guild.id;

    if (sub === 'panel' || sub === 'show' || sub === 'create') {
      return postMcpPanel(message);
    }
    if (sub === 'help' || sub === 'h') {
      return message.reply(
        `**MCP** — \`${PREFIX}mcp panel\` (buttons: baseUrl required, header/auth optional)\n` +
        `\`${PREFIX}mcp add <name> <baseUrl> [auth]\` | \`${PREFIX}mcp list\` | \`${PREFIX}mcp test <name>\` | \`${PREFIX}mcp tools <name>\` | \`${PREFIX}mcp call <server> <tool> [json]\` | \`${PREFIX}mcp remove <name>\`\n` +
        `Slash: \`/mcp\` (panel/add/list/test/tools/call/remove)`
      );
    }
    if (sub === 'list' || sub === 'ls') {
      const rows = listMcpServers(gid);
      if (!rows.length) return message.reply('📋 No MCP servers yet! Run `!mcp panel` → ➕ Add.');
      return message.reply(`📋 MCP servers:\n${rows.map(r => `• **${r.name}** — \`${r.base_url}\`${r.hasAuth ? ` (auth set)` : ''}`).join('\n').slice(0, 1800)}`);
    }
    if (sub === 'add') {
      if (!canManage(message)) return message.reply('❌ Mods only!');
      const [nameRaw, baseRaw, ...rest] = args.slice(1);
      const name = String(nameRaw || '').toLowerCase();
      if (!validMcpName(name) || !baseRaw) return message.reply(`❌ Usage: \`${PREFIX}mcp add <name> <baseUrl> [auth]\` (headers via the panel modal!)`);
      const base = normalizeMcpUrl(baseRaw);
      if (!base) return message.reply('❌ Invalid base URL!');
      const auth = rest.join(' ').trim() || null;
      message.delete().catch(() => {});
      const t = await testMcpServer(base, null, auth);
      upsertMcpServer(gid, name, base, null, auth);
      return message.channel.send(t.ok ? `✅ **${name}** saved! Connection OK.` : `⚠️ **${name}** saved, but test failed: ${t.error}`);
    }
    if (sub === 'remove' || sub === 'delete' || sub === 'rm') {
      if (!canManage(message)) return message.reply('❌ Mods only!');
      const ok = deleteMcpServer(gid, args[1] || '');
      return message.reply(ok ? `🗑️ Deleted!` : '⚠️ Server not found!');
    }
    if (sub === 'test') {
      const s = getMcpServer(gid, args[1] || '');
      if (!s) return message.reply('⚠️ Server not found!');
      const thinking = await message.reply('🧪 Testing...').catch(() => null);
      const t = await testMcpServer(s.base_url, s.headers, s.auth);
      const txt = t.ok ? `✅ **${s.name}** OK!` : `❌ **${s.name}** fail: ${t.error}`;
      if (thinking) return thinking.edit(txt).catch(() => {});
      return message.reply(txt).catch(() => {});
    }
    if (sub === 'login') {
      let name = args[1] || '';
      if (!name) {
        const rows = listMcpServers(gid);
        if (!rows.length) return message.reply('📋 No MCP servers yet! First `!mcp panel` → ➕ Add.');
        return message.reply(`🔑 Which one to log into?\n${rows.map(r => `• \`${PREFIX}mcp login ${r.name}\``).join('\n')}`);
      }
      const thinking = await message.reply('🔑 Creating login link...').catch(() => null);
      const r = await startMcpLogin(gid, name);
      const txt = r.ok
        ? `🔑 **Login link (valid 10 min):**\n${r.url}\n\n1. Open the link and log in on the provider site\n2. After authorize it connects automatically!`
        : `❌ ${r.error}`;
      if (thinking) return thinking.edit(txt).catch(() => {});
      return message.reply(txt).catch(() => {});
    }
    if (sub === 'tools' || sub === 'tool') {
      const s = getMcpServer(gid, args[1] || '');
      if (!s) return message.reply('⚠️ Server not found!');
      const thinking = await message.reply('🛠️ Loading tools...').catch(() => null);
      const t = await listMcpTools(s);
      const txt = !t.ok ? `❌ ${t.error}` : (!t.tools.length ? '🛠️ No tools!' : `🛠️ **${s.name}**:\n${t.tools.map(x => `• **${x.name}** — ${x.description || ''}`).join('\n').slice(0, 1800)}`);
      if (thinking) return thinking.edit(txt).catch(() => {});
      return message.reply(txt).catch(() => {});
    }
    if (sub === 'call') {
      const [srv, tool, ...rest] = args.slice(1);
      const s = getMcpServer(gid, srv || '');
      if (!s || !tool) return message.reply(`❌ Usage: \`${PREFIX}mcp call <server> <tool> [json]\``);
      const thinking = await message.reply('🛠️ Calling...').catch(() => null);
      const r = await callMcpTool(s, tool, rest.join(' '));
      const txt = r.ok ? `🛠️ Result:\n${r.text}` : `❌ ${r.error}`;
      if (thinking) return thinking.edit(txt.slice(0, 1900)).catch(() => {});
      return message.reply(txt.slice(0, 1900)).catch(() => {});
    }
    return message.reply(`❓ Unknown! \`${PREFIX}mcp panel|add|list|test|tools|call|remove\``);
  },
};
