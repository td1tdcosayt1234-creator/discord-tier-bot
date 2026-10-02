import { EmbedBuilder } from 'discord.js';

export default {
  name: 'avatar',
  execute(message) {
    const user = message.mentions.users.first() || message.author;
    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s Avatar`)
      .setImage(user.displayAvatarURL({ size: 512 }))
      .setColor(0x5865f2);
    return message.reply({ embeds: [embed] });
  },
};
