import { statSync } from 'node:fs';
import { AttachmentBuilder } from 'discord.js';
import { resolvePath } from '../agent.js';

export default {
  name: 'get',
  async execute(message, args) {
    const p = args.join(' ').trim().slice(0, 200);
    if (!p) return message.reply('Usage: `!get <path>` (see `!files` for paths)');
    const r = resolvePath(message.guild.id, p);
    if (!r.ok) return message.reply(`❌ ${r.error}`);
    let st;
    try {
      st = statSync(r.abs);
    } catch {
      return message.reply('❌ File not found! See `!files`.');
    }
    if (!st.isFile()) return message.reply('❌ That is a folder! `!files <folder>` to list, or ask `!ai` to zip it first.');
    if (st.size > 20 * 1024 * 1024) return message.reply('❌ Too big for Discord (>20MB)!');
    const name = r.rel.split('/').pop();
    try {
      return await message.reply({ files: [new AttachmentBuilder(r.abs, { name })] });
    } catch {
      return message.reply('❌ Could not send the file!');
    }
  },
};
