import { askAI } from '../ai.js';
import { postPanel, createSessionChannel } from '../aiPanel.js';
import { getAISession, deleteAISession, getUserSessions } from '../db.js';
import { PermissionsBitField } from 'discord.js';

export default {
  name: 'ai',
  async execute(message, args, client, PREFIX) {
    const sub = (args[0] || '').toLowerCase();

    // !ai panel [create] -> post button panel (mods)
    if (sub === 'panel') {
      const action = (args[1] || 'create').toLowerCase();
      if (action === 'create' || action === 'show' || action === 'post') {
        return postPanel(message, PREFIX);
      }
      return message.reply(`Usage: \`${PREFIX}ai panel create\``);
    }

    // !ai new -> direct private channel (same as the button)
    if (sub === 'new' || sub === 'create' || sub === 'open') {
      const thinking = await message.reply('🔌 Opening your private AI channel...').catch(() => null);
      try {
        const ch = await createSessionChannel(message.guild, message.author);
        if (thinking) return thinking.edit(`✅ Your private AI channel: <#${ch.id}>`).catch(() => {});
        return message.reply(`✅ Your private AI channel: <#${ch.id}>`).catch(() => {});
      } catch (e) {
        const err = `❌ ${e.message}`;
        if (thinking) return thinking.edit(err).catch(() => {});
        return message.reply(err).catch(() => {});
      }
    }

    // !ai close -> close current session channel
    if (sub === 'close' || sub === 'delete') {
      const sess = getAISession(message.channel.id);
      if (!sess) return message.reply('❌ Eta AI chat channel na!');
      const isOwner = sess.user_id === message.author.id;
      const isMod = message.member?.permissions?.has(PermissionsBitField.Flags.ManageMessages);
      if (!isOwner && !isMod) return message.reply('❌ Sudhu owner / mod close korte parbe!');
      await message.reply('🗑️ Closing in 3s...').catch(() => {});
      deleteAISession(message.channel.id);
      setTimeout(() => message.channel.delete().catch(() => {}), 3000);
      return;
    }

    // !ai my -> list sessions
    if (sub === 'my' || sub === 'list' || sub === 'chats') {
      const rows = getUserSessions(message.guild.id, message.author.id).filter(r => message.guild.channels.cache.get(r.channel_id));
      if (!rows.length) return message.reply('📋 You have no open AI chats! Type `!ai new`.');
      return message.reply(`📋 Your chats:\n${rows.map(r => `<#${r.channel_id}>`).join('\n')}`);
    }

    // normal: !ai <question>
    const prompt = args.join(' ').trim().slice(0, 1000);
    if (!prompt) {
      return message.reply(
        `Usage: \`${PREFIX}ai <question>\` | \`${PREFIX}ai new\` (private channel) | \`${PREFIX}ai panel create\` (mods) | \`/ai\`, \`/aipanel\`, \`/ainew\``
      );
    }

    const thinking = await message.reply('Thinking...').catch(() => null);
    const result = await askAI(prompt, message.guild.id, message.author.id);

    if (!result.ok) {
      const err = result.needAuth
        ? `🔒 ${result.error}\nOr unlock with an owner code: \`!!connect auth <CODE>\`, or keyless login: \`!!connect login\`.`
        : `⚠️ ${result.error}`;
      if (thinking) return thinking.edit(err).catch(() => {});
      return message.reply(err).catch(() => {});
    }
    let text = result.text;
    if (result.customError) text += `\n\n_(note: custom API failed (${result.customError}), used free AI)_`;
    if (text.length > 1900) text = text.slice(0, 1900) + '...';
    if (thinking) return thinking.edit(text).catch(() => {});
    return message.reply(text).catch(() => {});
  },
};
