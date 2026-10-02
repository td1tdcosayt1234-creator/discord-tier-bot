import { askAI } from '../ai.js';

export default {
  name: 'ai',
  async execute(message, args, client, PREFIX) {
    const prompt = args.join(' ');
    if (!prompt) return message.reply(`❌ Usage: \`${PREFIX}ai <your question>\``);

    const thinking = await message.reply('🤔 Thinking...');
    const answer = await askAI(prompt);
    if (!answer) return thinking.edit('⚠️ AI is busy right now, try again later!');
    const text = answer.length > 1900 ? answer.slice(0, 1900) + '...' : answer;
    return thinking.edit(text);
  },
};
