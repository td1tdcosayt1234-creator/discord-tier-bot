// Shared free-AI helper: no API key, no login.
// Tries each provider in order, falls back to the next on failure.
const PROVIDERS = [
  { url: 'https://text.pollinations.ai/openai', model: 'openai' },
  { url: 'https://dg-ai.scriptsnsenses.workers.dev/v1/chat/completions', model: 'gpt-oss' },
];

export async function askAI(prompt) {
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
