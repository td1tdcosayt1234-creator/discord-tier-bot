import { EmbedBuilder } from 'discord.js';
import { EIGHT_BALL_RESPONSES } from '../data.js';

export default {
  name: '8ball',
  execute(message, args, client, PREFIX) {
    const question = args.join(' ');
    if (!question) return message.reply(`🎱 Please ask a question! Example: \`${PREFIX}8ball Will it rain?\``);
    const answer = EIGHT_BALL_RESPONSES[Math.floor(Math.random() * EIGHT_BALL_RESPONSES.length)];
    const embed = new EmbedBuilder()
      .setTitle('🎱 Magic 8-Ball')
      .setColor(0x2b2d31)
      .addFields({ name: '❓ Question', value: question }, { name: '💬 Answer', value: answer });
    return message.reply({ embeds: [embed] });
  },
};
