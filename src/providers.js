// Central provider catalog for /connect login + !connect login.
// kind: 'keyless' (one-click browser), 'device' (enter code on site),
//       'oauth' (Google OAuth), 'key' (paste API key), 'free' (no login).
export const LOGIN_PROVIDERS = [
  { id: 'openrouter', label: 'OpenRouter', kind: 'keyless', emoji: '🌐', desc: '1-click browser login, 400+ models', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'google', label: 'Google Gemini', kind: 'oauth', emoji: '✨', desc: 'Sign in with Google, auto-connected', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'huggingface', label: 'Hugging Face', kind: 'device', emoji: '🤗', desc: 'Enter code on site, auto-connects', keyUrl: 'https://huggingface.co/settings/tokens' },
  { id: 'github', label: 'GitHub Models', kind: 'device', emoji: '🐙', desc: 'Enter code on github.com/login/device', keyUrl: 'https://github.com/settings/tokens' },
  { id: 'pollinations', label: 'Pollinations (free)', kind: 'free', emoji: '🆓', desc: 'No login needed — built-in free AI', keyUrl: '' },
  { id: 'groq', label: 'Groq', kind: 'key', emoji: '⚡', desc: 'Ultra-fast Llama — paste key', keyUrl: 'https://console.groq.com/keys' },
  { id: 'cerebras', label: 'Cerebras', kind: 'key', emoji: '🧠', desc: 'Fast inference — paste key', keyUrl: 'https://cloud.cerebras.ai' },
  { id: 'together', label: 'Together AI', kind: 'key', emoji: '🤝', desc: 'Open models — paste key', keyUrl: 'https://api.together.xyz/settings/api-keys' },
  { id: 'fireworks', label: 'Fireworks', kind: 'key', emoji: '🎆', desc: 'Fast serving — paste key', keyUrl: 'https://fireworks.ai' },
  { id: 'mistral', label: 'Mistral', kind: 'key', emoji: '🌬️', desc: 'Mistral models — paste key', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'key', emoji: '🔍', desc: 'DeepSeek chat — paste key', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'xai', label: 'xAI Grok', kind: 'key', emoji: '❌', desc: 'Grok models — paste key', keyUrl: 'https://console.x.ai' },
  { id: 'cohere', label: 'Cohere', kind: 'key', emoji: '🌀', desc: 'Command models — paste key', keyUrl: 'https://dashboard.cohere.com/api-keys' },
  { id: 'openai', label: 'OpenAI', kind: 'key', emoji: '🤖', desc: 'GPT models — paste key', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', label: 'Gemini API key', kind: 'key', emoji: '💎', desc: 'Google AI Studio key — paste key', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'nebius', label: 'Nebius', kind: 'key', emoji: '☁️', desc: 'Open models — paste key', keyUrl: 'https://studio.nebius.com/settings/api-keys' },
];

export function getLoginProvider(id) {
  const k = String(id || '').toLowerCase();
  return LOGIN_PROVIDERS.find(p => p.id === k) || null;
}

export function keyLoginHelp(p, prefix = '!') {
  if (!p) return null;
  if (p.kind === 'free') {
    return `🆓 **${p.label}** needs no login — just use \`!ai <question>\`!`;
  }
  if (p.kind === 'key') {
    return [
      `🔑 **Connect ${p.label} ${p.emoji}**`,
      ``,
      `**1.** Get a key: ${p.keyUrl}`,
      `**2.** In Discord run:`,
      `\`${prefix}connect ${p.id === 'gemini' ? 'gemini' : p.id} <API_KEY>\``,
      `or slash: \`/connect key provider:${p.id} key:<API_KEY>\``,
      ``,
      `_Your key message is auto-deleted after saving._`,
    ].join('\n');
  }
  return null;
}
