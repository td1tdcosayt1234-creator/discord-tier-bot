import { EmbedBuilder } from 'discord.js';

export default {
  name: 'userinfo',
  async execute(message) {
    const user = message.mentions.users.first() || message.author;
    const member = await message.guild.members.fetch(user.id).catch(() => null);
    const embed = new EmbedBuilder()
      .setTitle(`👤 ${user.tag}`)
      .setThumbnail(user.displayAvatarURL())
      .setColor(0x5865f2)
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Joined Server', value: member?.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : 'Unknown', inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(user.createdAt.getTime() / 1000)}:R>`, inline: true },
      )
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  },
};
