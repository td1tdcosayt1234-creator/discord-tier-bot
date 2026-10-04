import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } from 'discord.js';
import { createAISession, getAISession, deleteAISession, getUserSessions, isBotAdmin } from './db.js';

export function buildPanel(prefix = '!') {
  const embed = new EmbedBuilder()
    .setTitle('🤖 AI Chat Panel')
    .setColor(0x5865f2)
    .setDescription([
      `Press **➕ New Chat** to open a private AI chat.`,
      `Just type in the channel — no \`${prefix}ai\` needed.`,
      ``,
      `• ➕ New Chat — a private channel for you + AI`,
      `• 📋 My Chats — your open chat list`,
      `• ❓ Help — how to use`,
    ].join('\n'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ai_new').setLabel('➕ New Chat').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ai_my').setLabel('📋 My Chats').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ai_help').setLabel('❓ Help').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

export function buildSessionControls() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ai_new').setLabel('➕ New Chat').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ai_close').setLabel('🗑️ Close').setStyle(ButtonStyle.Danger),
  )];
}

function needsMod(member) {
  return member?.permissions?.has(PermissionsBitField.Flags.ManageMessages);
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

export async function createSessionChannel(guild, user) {
  const bot = guild.members.me;
  if (!bot?.permissions?.has(PermissionsBitField.Flags.ManageChannels)) {
    throw new Error('Bot needs **Manage Channels** permission!');
  }
  const name = `ai-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 90) || 'ai-chat';
  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    topic: `Private AI chat for ${user.tag} — just type, no !ai needed.`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      ...(bot?.id ? [{ id: bot.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }] : []),
    ],
  });
  createAISession(channel.id, guild.id, user.id);
  await channel.send({
    content: `<@${user.id}> just type here — no \`!ai\` needed!`,
    embeds: [new EmbedBuilder().setTitle('🤖 Private AI Chat').setColor(0x5865f2).setDescription('Whatever you write, the AI answers.\nPress 🗑️ Close to close.')],
    components: buildSessionControls(),
  }).catch(() => {});
  return channel;
}

export async function handlePanelButton(interaction) {
  const { customId, user, guild, channel } = interaction;
  if (!guild) return interaction.reply({ content: 'Server only!', ephemeral: true }).catch(() => {});

  if (customId === 'ai_new') {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    try {
      // anti-spam: max 3 open AI channels per user + 1/min
      const now = Date.now();
      const recent = getUserSessions(guild.id, user.id).filter(r => guild.channels.cache.get(r.channel_id));
      if (recent.length >= 3) {
        return interaction.editReply({ content: '❌ Max 3 open AI chats! Close one with 🗑️ first.' }).catch(() => {});
      }
      const lastNew = globalThis.__aiNewHits?.get(user.id) || 0;
      if (now - lastNew < 60 * 1000) {
        return interaction.editReply({ content: '⏳ Wait a minute before opening another chat!' }).catch(() => {});
      }
      if (!globalThis.__aiNewHits) globalThis.__aiNewHits = new Map();
      globalThis.__aiNewHits.set(user.id, now);
      if (globalThis.__aiNewHits.size > 1000) {
        for (const [k, t] of globalThis.__aiNewHits) if (now - t > 5 * 60 * 1000) globalThis.__aiNewHits.delete(k);
      }
      const ch = await createSessionChannel(guild, user);
      return interaction.editReply({ content: `✅ Your private AI channel: <#${ch.id}>` }).catch(() => {});
    } catch (e) {
      return interaction.editReply({ content: `❌ ${e.message}` }).catch(() => {});
    }
  }

  if (customId === 'ai_my') {
    const rows = getUserSessions(guild.id, user.id).filter(r => guild.channels.cache.get(r.channel_id));
    if (!rows.length) return interaction.reply({ content: '📋 You have no open AI chats! Press ➕ New Chat.', ephemeral: true }).catch(() => {});
    return interaction.reply({ content: `📋 Your chats:\n${rows.map(r => `<#${r.channel_id}>`).join('\n')}`, ephemeral: true }).catch(() => {});
  }

  if (customId === 'ai_help') {
    return interaction.reply({
      content: `**AI Panel Help**\n• ➕ New Chat → opens a private channel (only you + AI)\n• Just type in the channel, no \`!ai\` needed\n• 🗑️ Close → deletes the channel\n• Slash: \`/aipanel\`, \`/ainew\`, \`/aiclose\`, \`/ai\``,
      ephemeral: true,
    }).catch(() => {});
  }

  if (customId === 'ai_close') {
    const sess = channel?.id ? getAISession(channel.id) : null;
    if (!sess) return interaction.reply({ content: '❌ This is not an AI chat channel!', ephemeral: true }).catch(() => {});
    const isOwner = sess.user_id === user.id;
    if (!isOwner && !canManageIx(interaction)) {
      return interaction.reply({ content: '❌ Only the owner / mods can close!', ephemeral: true }).catch(() => {});
    }
    await interaction.reply({ content: '🗑️ Closing in 3s...', ephemeral: true }).catch(() => {});
    deleteAISession(channel.id);
    setTimeout(() => channel.delete().catch(() => {}), 3000);
  }
}

export async function postPanel(message, prefix) {
  if (!canManage(message)) {
    return message.reply('❌ Mods only! Posting a panel needs **Manage Messages**.');
  }
  return message.channel.send(buildPanel(prefix));
}
