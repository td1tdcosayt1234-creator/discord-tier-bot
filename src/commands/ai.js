export default {
  name: 'ai',
  async execute(message, args, client, PREFIX) {
    const prompt = args.join(' ');
    if (!prompt) return message.reply(`❌ Usage: \`${PREFIX}ai <your question>\``);

    const thinking = await message.reply('🤔 Thinking...');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const res = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let text = (await res.text()).trim();
      if (!text) throw new Error('empty response');
      if (text.length > 1900) text = text.slice(0, 1900) + '...';
      return thinking.edit(text);
    } catch (err) {
      console.error(err);
      return thinking.edit('⚠️ AI is busy right now, try again later!');
    }
  },
};
