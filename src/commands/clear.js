import { PermissionsBitField } from 'discord.js';

export default {
  name: 'clear',
  async execute(message, args) {
    const member = message.member;
    if (!member?.permissions?.has(PermissionsBitField.Flags.ManageMessages)) {
      return message.reply('❌ You need the **Manage Messages** permission to use this!');
    }
    if (!message.guild.members.me?.permissions?.has(PermissionsBitField.Flags.ManageMessages)) {
      return message.reply("❌ I need the **Manage Messages** permission to delete!");
    }
    const amount = parseInt(args[0], 10);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100) {
      return message.reply('Please provide a number between 1 and 100!');
    }
    try {
      const deleted = await message.channel.bulkDelete(amount, true);
      if (deleted.size === 0) {
        return message.reply("Couldn't delete messages (they may be older than 14 days).");
      }
      const msg = await message.channel.send(`🧹 Deleted **${deleted.size}** messages!`);
      setTimeout(() => msg.delete().catch(() => {}), 3000);
    } catch {
      return message.reply("Couldn't delete messages (they may be older than 14 days).");
    }
  },
};
