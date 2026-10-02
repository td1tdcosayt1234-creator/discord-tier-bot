// Free public AI providers - no API key, no login needed.
// Tries each in order, falls back to the next on failure.
const PROVIDERS = [
  { url: 'https://text.pollinations.ai/openai', model: 'openai' },
  { url: 'https://dg-ai.scriptsnsenses.workers.dev/v1/chat/completions', model: 'gpt-oss' },
];

async function askAI(prompt) {
  for (const p of PROVIDERS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: prompt }] }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    } catch {
      // try next provider
    }
  }
  return null;
}

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
