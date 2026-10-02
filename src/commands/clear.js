import { PermissionsBitField } from 'discord.js';

export default {
  name: 'clear',
  async execute(message, args) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return message.reply('❌ You need the **Manage Messages** permission to use this!');
    }
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount < 1 || amount > 100) {
      return message.reply('Please provide a number between 1 and 100!');
    }
    await message.channel.bulkDelete(amount + 1, true).catch(() => message.reply("Couldn't delete messages (they may be older than 14 days)."));
    const msg = await message.channel.send(`🧹 Deleted **${amount}** messages!`);
    setTimeout(() => msg.delete().catch(() => {}), 3000);
  },
};
