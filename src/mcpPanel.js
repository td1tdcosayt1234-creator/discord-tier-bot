import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField } from 'discord.js';
import { upsertMcpServer, listMcpServers, getMcpServer, deleteMcpServer, isBotAdmin } from './db.js';
import { normalizeMcpUrl, validMcpName, parseHeaders, testMcpServer, listMcpTools, callMcpTool, maskAuth } from './mcp.js';
import { startMcpLogin } from './mcpAuth.js';

function needsMod(member) {
  return member?.permissions?.has(PermissionsBitField.Flags.ManageMessages)
    || member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
}

// Mods + users joined with an admin code
function canManageIx(interaction) {
  if (needsMod(interaction.member)) return true;
  return isBotAdmin(interaction.guildId, interaction.user.id);
}

function canManage(message) {
  if (needsMod(message.member)) return true;
  return isBotAdmin(message.guild.id, message.author.id);
}

export function buildMcpPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🔌 MCP Panel')
    .setColor(0x5865f2)
    .setDescription([
      `Connect an MCP server — **baseUrl required**, **header optional**, **auth optional**.`,
      ``,
      `• ➕ Add — name + baseUrl + (header/auth optional)`,
      `• 🔑 Login — log in on the provider site, no token needed (OAuth, like Notion)`,
      `• 📋 List — saved server list`,
      `• 🧪 Test — connection check`,
      `• 🛠️ Tools — tool list`,
      `• 🗑️ Remove — server delete`,
    ].join('\n'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mcp_add').setLabel('➕ Add').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mcp_list').setLabel('📋 List').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mcp_test').setLabel('🧪 Test').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mcp_tools').setLabel('🛠️ Tools').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mcp_remove').setLabel('🗑️ Remove').setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mcp_login').setLabel('🔑 Login').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('mcp_call').setLabel('📞 Call Tool').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row, row2] };
}

function addModal() {
  const m = new ModalBuilder().setCustomId('mcp_add_modal').setTitle('Add MCP Server');
  m.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Name (a-z, 0-9, -, _)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('base_url').setLabel('Base URL (required)').setPlaceholder('https://example.com/mcp').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(300)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('headers').setLabel('Headers (optional)').setPlaceholder('{"X-Key":"v"} or X-Key: v').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('auth').setLabel('Auth (optional)').setPlaceholder('Bearer token / API key').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500)),
  );
  return m;
}

function nameModal(id, title, label) {
  const m = new ModalBuilder().setCustomId(id).setTitle(title);
  m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)));
  return m;
}

function callModal() {
  const m = new ModalBuilder().setCustomId('mcp_call_modal').setTitle('Call MCP Tool');
  m.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Server name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tool').setLabel('Tool name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('args').setLabel('Args JSON (optional)').setPlaceholder('{"q":"hi"}').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000)),
  );
  return m;
}

export async function handleMcpButton(interaction) {
  const id = interaction.customId;
  if (id === 'mcp_add') {
    if (!canManageIx(interaction)) return interaction.reply({ content: '❌ Mods only!', ephemeral: true }).catch(() => {});
    return interaction.showModal(addModal()).catch(() => {});
  }
  if (id === 'mcp_list') {
    const rows = listMcpServers(interaction.guildId);
    if (!rows.length) return interaction.reply({ content: '📋 No MCP servers yet! Press ➕ Add.', ephemeral: true }).catch(() => {});
    const txt = rows.map(r => `• **${r.name}** — \`${r.base_url}\`${r.hasAuth ? ` (auth set)` : ''}`).join('\n').slice(0, 1800);
    return interaction.reply({ content: `📋 MCP servers:\n${txt}`, ephemeral: true }).catch(() => {});
  }
  if (id === 'mcp_test') return interaction.showModal(nameModal('mcp_test_modal', 'Test MCP Server', 'Server name')).catch(() => {});
  if (id === 'mcp_tools') return interaction.showModal(nameModal('mcp_tools_modal', 'MCP Tools', 'Server name')).catch(() => {});
  if (id === 'mcp_remove') {
    if (!canManageIx(interaction)) return interaction.reply({ content: '❌ Mods only!', ephemeral: true }).catch(() => {});
    return interaction.showModal(nameModal('mcp_remove_modal', 'Remove MCP Server', 'Server name')).catch(() => {});
  }
  if (id === 'mcp_login') {
    return interaction.showModal(nameModal('mcp_login_modal', 'MCP Login (no token)', 'Server name (age Add kora)')).catch(() => {});
  }
  if (id === 'mcp_call') return interaction.showModal(callModal()).catch(() => {});
}

export async function handleMcpModal(interaction) {
  const id = interaction.customId;
  const gid = interaction.guildId;
  const f = (k) => interaction.fields.getTextInputValue(k)?.trim() || '';

  if (id === 'mcp_add_modal') {
    if (!canManageIx(interaction)) return interaction.reply({ content: '❌ Mods only!', ephemeral: true }).catch(() => {});
    const name = f('name').toLowerCase(), base = f('base_url'), headers = f('headers'), auth = f('auth');
    if (!validMcpName(name)) return interaction.reply({ content: '❌ Invalid name! `a-z 0-9 - _`, max 32.', ephemeral: true }).catch(() => {});
    if (!normalizeMcpUrl(base)) return interaction.reply({ content: '❌ Invalid base URL! Use `https://...`.', ephemeral: true }).catch(() => {});
    const p = parseHeaders(headers);
    if (!p.ok) return interaction.reply({ content: `❌ ${p.error}`, ephemeral: true }).catch(() => {});
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const t = await testMcpServer(base, headers, auth);
    upsertMcpServer(gid, name, normalizeMcpUrl(base), headers || null, auth || null);
    return interaction.editReply({ content: t.ok ? `✅ **${name}** saved! Connection OK.${auth ? '' : ' (no auth)'}` : `⚠️ **${name}** saved, kintu test fail: ${t.error}` }).catch(() => {});
  }
  if (id === 'mcp_remove_modal') {
    if (!canManageIx(interaction)) return interaction.reply({ content: '❌ Mods only!', ephemeral: true }).catch(() => {});
    const ok = deleteMcpServer(gid, f('name'));
    return interaction.reply({ content: ok ? `🗑️ **${f('name')}** deleted!` : '⚠️ Server not found!', ephemeral: true }).catch(() => {});
  }
  if (id === 'mcp_test_modal') {
    const s = getMcpServer(gid, f('name'));
    if (!s) return interaction.reply({ content: '⚠️ Server not found!', ephemeral: true }).catch(() => {});
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const t = await testMcpServer(s.base_url, s.headers, s.auth);
    return interaction.editReply(t.ok ? `✅ **${s.name}** OK!` : `❌ **${s.name}** fail: ${t.error}`).catch(() => {});
  }
  if (id === 'mcp_tools_modal') {
    const s = getMcpServer(gid, f('name'));
    if (!s) return interaction.reply({ content: '⚠️ Server not found!', ephemeral: true }).catch(() => {});
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const t = await listMcpTools(s);
    if (!t.ok) return interaction.editReply(`❌ ${t.error}`).catch(() => {});
    if (!t.tools.length) return interaction.editReply('🛠️ No tools!').catch(() => {});
    return interaction.editReply(`🛠️ **${s.name}** tools:\n${t.tools.map(x => `• **${x.name}** — ${x.description || 'no desc'}`).join('\n').slice(0, 1800)}`).catch(() => {});
  }
  if (id === 'mcp_call_modal') {
    const s = getMcpServer(gid, f('name'));
    if (!s) return interaction.reply({ content: '⚠️ Server not found!', ephemeral: true }).catch(() => {});
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const r = await callMcpTool(s, f('tool'), f('args'));
    return interaction.editReply(r.ok ? `🛠️ Result:\n${r.text}` : `❌ ${r.error}`).catch(() => {});
  }
  if (id === 'mcp_login_modal') {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const r = await startMcpLogin(gid, f('name'));
    if (!r.ok) return interaction.editReply(`❌ ${r.error}`).catch(() => {});
    return interaction.editReply(
      `🔑 **Login link (valid 10 min):**\n${r.url}\n\n1. Open the link and log in on the provider site\n2. After authorize, it connects automatically — nothing else to do in Discord!`
    ).catch(() => {});
  }
}

export async function postMcpPanel(message) {
  if (!canManage(message)) return message.reply('❌ Mods only! Posting a panel needs **Manage Messages**.');
  return message.channel.send(buildMcpPanel());
}
