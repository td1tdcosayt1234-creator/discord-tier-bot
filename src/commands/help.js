import { EmbedBuilder } from 'discord.js';

export default {
  name: 'help',
  execute(message, args, client, PREFIX) {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Bot Commands')
      .setColor(0x5865f2)
      .setDescription([
        `\`${PREFIX}ping\` - Check bot latency`,
        `\`${PREFIX}8ball <question>\` - Ask the magic 8-ball`,
        `\`${PREFIX}roll [number]\` - Roll a dice`,
        `\`${PREFIX}joke\` - Get a random joke`,
        `\`${PREFIX}say <text>\` - Make the bot say something`,
        `\`${PREFIX}userinfo [@user]\` - Info about a user`,
        `\`${PREFIX}serverinfo\` - Info about this server`,
        `\`${PREFIX}avatar [@user]\` - Get someone's avatar`,
        `\`${PREFIX}clear <amount>\` - Delete messages (mods)`,
        `\`${PREFIX}tier show\` - Show the tier list`,
        `\`${PREFIX}tier create <NAME>\` - Create a new tier`,
        `\`${PREFIX}tier delete <NAME>\` - Delete a tier`,
        `\`${PREFIX}tier add <TIER> <player>\` - Add player to a tier`,
        `\`${PREFIX}tier remove <S/A/B/C/D> <player>\` - Remove player`,
        `\`${PREFIX}tier setname <name>\` - Rename the tier list`,
        `\`${PREFIX}tier reset\` - Clear the tier list`,
      ].join('\n'))
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  },
};
