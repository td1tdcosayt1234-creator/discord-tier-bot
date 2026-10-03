// Shared AI helper: free providers + optional per-guild custom endpoint.
// 1) !!connect auth <CODE> -> unlocks free AI (owner sets AI_AUTH_CODE)
// 2) !!connect login -> keyless browser login via OpenRouter (PKCE, no setup)
// 3) !!connect <provider> <API_KEY> [model] -> use that platform's key
//    e.g. !!connect gemini AIza...  (key from https://aistudio.google.com/apikey)
//    Supported: gemini, openai, groq, openrouter, deepseek, huggingface,
//    xai, cerebras, fireworks, together, mistral, api (custom URL)

import { getAIConfigFull, isUserAuthorized, getUserKey, setUserKey } from './db.js';

const FREE_PROVIDERS = [
  { url: 'https://text.pollinations.ai/openai', model: 'openai' },
  { url: 'https://dg-ai.scriptsnsenses.workers.dev/v1/chat/completions', model: 'gpt-oss' },
];

export const AI_PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.0-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    hint: 'AIza... (Google AI Studio)',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    hint: 'sk-...',
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys',
    hint: 'gsk_...',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    keyUrl: 'https://openrouter.ai/keys',
    hint: 'sk-or-...',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    hint: 'sk-...',
  },
  huggingface: {
    label: 'Hugging Face',
    baseUrl: 'https://router.huggingface.co/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    keyUrl: 'https://huggingface.co/settings/tokens',
    hint: 'hf_...',
  },
  xai: {
    label: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-mini',
    keyUrl: 'https://console.x.ai',
    hint: 'xai-...',
  },
  cerebras: {
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    keyUrl: 'https://cloud.cerebras.ai',
    hint: 'csk-...',
  },
  fireworks: {
    label: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    keyUrl: 'https://fireworks.ai',
    hint: 'fw_...',
  },
  together: {
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    keyUrl: 'https://api.together.xyz/settings/api-keys',
    hint: '...',
  },
  mistral: {
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    keyUrl: 'https://console.mistral.ai/api-keys',
    hint: '...',
  },
};

export const GEMINI_NATIVE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const TIMEOUT_MS = 45000;

export function isAuthRequired() {
  return !!String(process.env.AI_AUTH_CODE || '').trim();
}

// When true, free AI needs per-user unlock (dashboard join code via /join,
// or owner auth code). Custom server keys and logged-in OAuth users bypass.
export function isCodeRequired() {
  if (String(process.env.REQUIRE_JOIN_CODE || '').toLowerCase() === 'true') return true;
  return isAuthRequired();
}

export function maskKey(key) {
  if (!key) return null;
  let s = String(key);
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object' && o.access_token) s = String(o.access_token);
  } catch { /* plain key */ }
  if (s.length <= 8) return '****';
  return `****${s.slice(-4)}`;
}

function normalizeBaseUrl(raw) {
  let s = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) return null;
  s = s.replace(/\/chat\/completions$/i, '');
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return s;
  } catch {
    return null;
  }
}

export function validateProviderInput(provider, apiKey, model) {
  const p = AI_PROVIDERS[String(provider || '').toLowerCase()];
  if (!p) return { error: `Unknown provider! Try: ${Object.keys(AI_PROVIDERS).join(', ')}` };
  const key = String(apiKey || '').trim();
  if (key.length < 8 || /\s/.test(key)) return { error: `Invalid ${p.label} key! Get one: ${p.keyUrl}` };
  const m = String(model || '').trim().slice(0, 120) || p.defaultModel;
  if (!/^[\w.:/\-]+$/.test(m)) return { error: 'Invalid model name!' };
  return { base: p.baseUrl, key, model: m, provider: String(provider).toLowerCase(), label: p.label };
}

export function validateCustomInput(baseUrl, apiKey, model) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return { error: 'Invalid base URL! Example: `https://api.openai.com/v1`' };
  const key = String(apiKey || '').trim();
  if (key.length < 8 || /\s/.test(key)) return { error: 'Invalid API key! It should be one token with no spaces (min 8 chars).' };
  const m = String(model || '').trim().slice(0, 120) || 'gpt-3.5-turbo';
  if (!/^[\w.:/\-]+$/.test(m)) return { error: 'Invalid model name!' };
  return { base, key, model: m, provider: 'custom' };
}

async function postChat(url, body, apiKey, provider) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://discord-tier-bot/';
      headers['X-Title'] = 'Discord Tier Bot';
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: errText.slice(0, 300) };
    }
    const data = await res.json().catch(() => null);
    const text =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.reply?.trim?.() ||
      (typeof data?.text === 'string' ? data.text.trim() : '');
    if (!text) return { ok: false, status: res.status, error: 'Empty response from AI' };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'AI timed out, try again!' : (e?.message || 'Request failed') };
  } finally {
    clearTimeout(timeout);
  }
}

export async function askFreeAI(prompt) {
  const clean = String(prompt || '').trim().slice(0, 1000);
  if (!clean) return null;
  for (const p of FREE_PROVIDERS) {
    const r = await postChat(p.url, { model: p.model, messages: [{ role: 'user', content: clean }] }, null);
    if (r.ok) return r.text;
  }
  return null;
}

export async function askCustomAI(prompt, { baseUrl, apiKey, model, provider }) {
  const clean = String(prompt || '').trim().slice(0, 1000);
  if (!clean) return { ok: false, error: 'Empty prompt' };
  const base = normalizeBaseUrl(baseUrl);
  if (!base || !apiKey) return { ok: false, error: 'Custom AI is not configured correctly' };
  // Native Gemini transport (OAuth logins): {base}/models/{model}:generateContent
  if (provider === 'gemini' && /\/v1beta\/?$/.test(base)) {
    return askGeminiNative(clean, base, apiKey, model || 'gemini-2.0-flash');
  }
  const { isPublicHttpUrl, SSRF_ERROR } = await import('./util.js');
  if (!(await isPublicHttpUrl(base))) return { ok: false, error: SSRF_ERROR };
  const r = await postChat(`${base}/chat/completions`, {
    model: model || 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: clean }],
  }, apiKey, provider);
  if (r.ok) return { ok: true, text: r.text };
  if (r.status === 401 || r.status === 403) return { ok: false, error: 'API key rejected (401/403). Wrong or expired key!' };
  if (r.status === 404) return { ok: false, error: 'Model not found (404)! Change it with !!connect model <name>.' };
  if (r.status === 429) return { ok: false, error: 'Rate limit / no credit (429)! Check billing/limits.' };
  return { ok: false, error: r.error || 'Custom AI failed, try again!' };
}

// Native Gemini generateContent (for Google OAuth access tokens).
export function parseGeminiNative(data) {
  try {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('').trim();
    return text || null;
  } catch {
    return null;
  }
}

async function askGeminiNative(prompt, base, accessToken, model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, error: 'Google token rejected! Run `!!connect login google` again.' };
      const t = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: t.slice(0, 300) || `Gemini failed (${res.status})` };
    }
    const data = await res.json().catch(() => null);
    const text = parseGeminiNative(data);
    if (!text) {
      if (data?.promptFeedback?.blockReason) return { ok: false, error: `Blocked by safety filter (${data.promptFeedback.blockReason})!` };
      return { ok: false, error: 'Empty response from Gemini' };
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'AI timed out, try again!' : (e?.message || 'Request failed') };
  } finally {
    clearTimeout(timeout);
  }
}

// Refresh an expiring Google OAuth user key. Returns { access } or { error, reauth }.
export async function ensureFreshGoogleKey(guildId, userId, uk) {
  let tok;
  try { tok = JSON.parse(uk.api_key); } catch { return { access: uk.api_key }; }
  if (!tok || typeof tok !== 'object' || !tok.access_token) return { access: uk.api_key };
  if (tok.expires_at && tok.expires_at > Date.now() + 5 * 60 * 1000) return { access: tok.access_token };
  if (!tok.refresh_token) return { error: 'Google session expired! Run `!!connect login google` again.', reauth: true };
  const cid = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const csec = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!cid || !csec) return { error: 'Google login is not configured anymore!', reauth: true };
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: cid, client_secret: csec }).toString(),
      signal: c.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.access_token) {
      if (data?.error === 'invalid_grant') return { error: 'Google session ended! Run `!!connect login google` again.', reauth: true };
      return { error: `Google refresh failed (${res.status})!`, reauth: true };
    }
    const fresh = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || tok.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    setUserKey(String(guildId), String(userId), uk.provider, uk.base_url, JSON.stringify(fresh), uk.model);
    return { access: fresh.access_token };
  } catch (e) {
    return { error: e?.message || 'Failed' };
  } finally {
    clearTimeout(t);
  }
}
export async function askAI(prompt, guildId, userId) {
  const clean = String(prompt || '').trim().slice(0, 1000);
  if (!clean) return { ok: false, error: 'Please give me a question!' };

  if (guildId) {
    // 1) per-user OAuth key (browser login, no API key paste) wins first
    if (userId) {
      const uk = getUserKey(String(guildId), String(userId));
      if (uk?.api_key) {
        let key = uk.api_key;
        if (uk.provider === 'gemini') {
          const fr = await ensureFreshGoogleKey(String(guildId), String(userId), uk);
          if (fr.error) {
            if (fr.reauth) return { ok: false, error: fr.error };
            const free = await askFreeAI(clean);
            if (free) return { ok: true, text: free, mode: 'free', customError: fr.error };
            return { ok: false, error: fr.error };
          }
          key = fr.access;
        }
        const custom = await askCustomAI(clean, { baseUrl: uk.base_url, apiKey: key, model: uk.model, provider: uk.provider });
        if (custom.ok) return { ok: true, text: custom.text, mode: 'oauth', provider: uk.provider };
        const free = await askFreeAI(clean);
        if (free) return { ok: true, text: free, mode: 'free', customError: custom.error };
        return { ok: false, error: custom.error || 'AI is busy right now, try again later!' };
      }
    }
    const cfg = getAIConfigFull(String(guildId));
    if (cfg.mode === 'custom' && cfg.baseUrl && cfg.apiKey) {
      const custom = await askCustomAI(clean, { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, provider: cfg.provider });
      if (custom.ok) return { ok: true, text: custom.text, mode: 'custom', provider: cfg.provider };
      const free = await askFreeAI(clean);
      if (free) return { ok: true, text: free, mode: 'free', customError: custom.error };
      return { ok: false, error: custom.error || 'AI is busy right now, try again later!' };
    }
    // Code gating (only when REQUIRE_JOIN_CODE/AI_AUTH_CODE set and no custom endpoint)
    if (isCodeRequired() && userId && !isUserAuthorized(String(guildId), String(userId))) {
      return { ok: false, needAuth: true, error: 'AI is locked! Get a join code from the admin dashboard, then type `/join <code>`.' };
    }
  }

  const free = await askFreeAI(clean);
  if (free) return { ok: true, text: free, mode: 'free' };
  return { ok: false, error: 'AI is busy right now, try again later!' };
}
