import { EmbedBuilder } from 'discord.js';

export default {
  name: 'serverinfo',
  execute(message) {
    const g = message.guild;
    const icon = g.iconURL();
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${g.name}`)
      .setColor(0x5865f2)
      .addFields(
        { name: 'Members', value: `${g.memberCount}`, inline: true },
        { name: 'Channels', value: `${g.channels.cache.size}`, inline: true },
        { name: 'Roles', value: `${g.roles.cache.size}`, inline: true },
        { name: 'Emojis', value: `${g.emojis.cache.size}`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(g.createdAt.getTime() / 1000)}:R>`, inline: true },
        { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
      )
      .setTimestamp();
    if (icon) embed.setThumbnail(icon);
    return message.reply({ embeds: [embed] });
  },
};
