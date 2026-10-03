// OpenRouter free models for /connect model autocomplete + !!connect models.
// Live list from the public OpenRouter API (no key needed), cached 1h,
// with a curated fallback when offline.
const LIST_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_MS = 60 * 60 * 1000;

// Curated fallback (id + short label). Used when the API is unreachable.
export const OPENROUTER_FREE_FALLBACK = [
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
  { id: 'meta-llama/llama-3.1-405b-instruct:free', label: 'Llama 3.1 405B Instruct' },
  { id: 'meta-llama/llama-3.1-8b-instruct:free', label: 'Llama 3.1 8B Instruct' },
  { id: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash Exp' },
  { id: 'google/gemma-3-27b-it:free', label: 'Gemma 3 27B IT' },
  { id: 'google/gemma-3-12b-it:free', label: 'Gemma 3 12B IT' },
  { id: 'deepseek/deepseek-chat-v3-0324:free', label: 'DeepSeek V3 0324' },
  { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1' },
  { id: 'qwen/qwen-2.5-72b-instruct:free', label: 'Qwen 2.5 72B Instruct' },
  { id: 'qwen/qwq-32b:free', label: 'Qwen QwQ 32B' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral Small 3.1 24B' },
  { id: 'mistralai/mistral-nemo:free', label: 'Mistral Nemo' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct:free', label: 'Nemotron 70B Instruct' },
  { id: 'microsoft/phi-4:free', label: 'Phi 4' },
  { id: 'cognitivecomputations/dolphin3.0-mistral-24b:free', label: 'Dolphin 3.0 Mistral 24B' },
  { id: 'deepseek/deepseek-r1-distill-llama-70b:free', label: 'R1 Distill Llama 70B' },
  { id: 'qwen/qwen-2.5-coder-32b-instruct:free', label: 'Qwen 2.5 Coder 32B' },
  { id: 'google/learnlm-1.5-pro-experimental:free', label: 'LearnLM 1.5 Pro Exp' },
];

let cache = { at: 0, models: null };

function shortLabel(id, name) {
  const n = String(name || '').trim();
  if (n) return n.slice(0, 60);
  const parts = String(id).split('/');
  return (parts[parts.length - 1] || id).replace(/:free$/, '').replace(/-/g, ' ').slice(0, 60);
}

// Returns { models: [{id, label}], live: bool }. Never throws.
export async function getFreeModels() {
  if (cache.models && Date.now() - cache.at < CACHE_MS) return { models: cache.models, live: true };
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const res = await fetch(LIST_URL, { signal: c.signal });
    const data = await res.json().catch(() => null);
    const rows = Array.isArray(data?.data) ? data.data : [];
    const free = rows
      .filter(m => m?.id && String(m.id).endsWith(':free'))
      .map(m => ({ id: String(m.id), label: shortLabel(m.id, m.name) }));
    if (free.length) {
      free.sort((a, b) => a.label.localeCompare(b.label));
      cache = { at: Date.now(), models: free };
      return { models: free, live: true };
    }
  } catch { /* fall through to fallback */ }
  finally { clearTimeout(t); }
  return { models: OPENROUTER_FREE_FALLBACK, live: false };
}

// Discord autocomplete choices (max 25, name ≤100 chars).
export async function searchFreeModels(query, limit = 25) {
  const { models } = await getFreeModels();
  const q = String(query || '').trim().toLowerCase();
  const hits = (q
    ? models.filter(m => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
    : models
  ).slice(0, Math.min(Math.max(limit | 0, 1), 25));
  return hits.map(m => ({ name: `${m.label} — ${m.id}`.slice(0, 100), value: m.id }));
}

// Plain-text lines for prefix replies.
export async function formatFreeModels(query, limit = 15) {
  const { models, live } = await getFreeModels();
  const q = String(query || '').trim().toLowerCase();
  const hits = (q
    ? models.filter(m => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
    : models
  ).slice(0, Math.min(Math.max(limit | 0, 1), 15));
  return {
    lines: hits.map(m => `• \`${m.id}\` — ${m.label}`),
    total: q ? models.filter(m => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)).length : models.length,
    live,
  };
}

export function isValidModelName(s) {
  const m = String(s || '').trim().slice(0, 120);
  return m && /^[\w.:/\-]+$/.test(m) ? m : null;
}
