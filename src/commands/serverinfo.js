import { EmbedBuilder } from 'discord.js';

export default {
  name: 'serverinfo',
  execute(message) {
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${message.guild.name}`)
      .setThumbnail(message.guild.iconURL())
      .setColor(0x5865f2)
      .addFields(
        { name: 'Members', value: `${message.guild.memberCount}`, inline: true },
        { name: 'Channels', value: `${message.guild.channels.cache.size}`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(message.guild.createdAt.getTime() / 1000)}:R>`, inline: true },
        { name: 'Owner', value: `<@${message.guild.ownerId}>`, inline: true },
      )
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  },
};
