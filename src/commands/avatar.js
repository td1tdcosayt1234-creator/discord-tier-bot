import { EmbedBuilder } from 'discord.js';

export default {
  name: 'avatar',
  execute(message) {
    const user = message.mentions.users.first() || message.author;
    const url = user.displayAvatarURL({ size: 1024 });
    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s Avatar`)
      .setImage(url)
      .setColor(0x5865f2);
    return message.reply({ embeds: [embed] });
  },
};
