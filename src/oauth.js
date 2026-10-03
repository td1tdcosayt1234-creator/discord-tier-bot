// Keyless logins (no API key paste):
// 1) OpenRouter: !!connect login -> URL -> user pastes code: !!connect code <CODE>
// 2) Hugging Face: !!connect login huggingface -> device code -> user enters it
//    on huggingface.co/device -> bot polls until authorized (needs HF_CLIENT_ID
//    in .env once: a public OAuth app with the `inference-api` scope).
import { randomBytes, createHash } from 'node:crypto';
import { saveOAuthPending, getOAuthPending, clearOAuthPending, setUserKey, saveOAuthState, consumeOAuthState } from './db.js';
import { AI_PROVIDERS, GEMINI_NATIVE_BASE } from './ai.js';

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createLogin(guildId, userId, appName = 'DiscordTierBot') {
  const verifier = base64url(randomBytes(32)); // 43 chars
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  saveOAuthPending(String(guildId), String(userId), verifier);
  // Headless mode: no callback_url, code shown on screen (works on localhost / VPS / RDP)
  const url = `https://openrouter.ai/auth?code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256&key_label=${encodeURIComponent(appName)}`;
  return { url, challenge };
}

export async function exchangeCode(guildId, userId, code) {
  const verifier = getOAuthPending(String(guildId), String(userId));
  if (!verifier) return { ok: false, error: 'First run `!!connect login`, then paste the code within 10 min!' };
  const clean = String(code || '').trim();
  if (!clean || clean.length < 4 || clean.length > 200 || /\s/.test(clean)) {
    return { ok: false, error: 'Invalid code! Copy the full code from the OpenRouter page.' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: clean, code_verifier: verifier, code_challenge_method: 'S256' }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.key) {
      return { ok: false, error: data?.error || `Exchange failed (${res.status})! Code expires in 10 min — run !!connect login again.` };
    }
    const p = AI_PROVIDERS.openrouter;
    setUserKey(String(guildId), String(userId), 'openrouter', p.baseUrl, data.key, p.defaultModel);
    clearOAuthPending(String(guildId), String(userId));
    return { ok: true, model: p.defaultModel };
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'Timed out, try again!' : (e?.message || 'Failed') };
  } finally {
    clearTimeout(timeout);
  }
}

export function hfConfigured() {
  return !!String(process.env.HF_CLIENT_ID || '').trim();
}

function hfAuthHeader() {
  const id = String(process.env.HF_CLIENT_ID || '').trim();
  const secret = String(process.env.HF_CLIENT_SECRET || '').trim();
  return secret
    ? { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') }
    : {};
}

// Step 1: get a device code for the user to enter on huggingface.co/device
export async function startHFDevice() {
  if (!hfConfigured()) {
    return { ok: false, error: 'Hugging Face login is not set up! Owner: create a public OAuth app (scope `inference-api`) at huggingface.co/settings/applications/new and set HF_CLIENT_ID in .env.' };
  }
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const body = new URLSearchParams({ client_id: process.env.HF_CLIENT_ID.trim(), scope: 'inference-api' });
    const res = await fetch('https://huggingface.co/oauth/device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...hfAuthHeader() },
      body: body.toString(), signal: c.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.device_code || !data?.user_code) {
      return { ok: false, error: data?.error_description || data?.error || `Device request failed (${res.status})` };
    }
    return {
      ok: true,
      deviceCode: data.device_code,
      userCode: data.user_code,
      url: data.verification_uri || 'https://huggingface.co/device',
      interval: Math.max(Number(data.interval) || 5, 5),
      expiresIn: Number(data.expires_in) || 600,
    };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed' };
  } finally {
    clearTimeout(t);
  }
}

// Step 2: poll until the user authorizes (or timeout/deny). Resolves once.
export async function pollHFDevice(deviceCode, intervalSec, maxWaitMs = 5 * 60 * 1000) {
  const deadline = Date.now() + Math.min(maxWaitMs, 10 * 60 * 1000);
  let wait = Math.max(intervalSec, 5) * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, wait));
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    try {
      const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: process.env.HF_CLIENT_ID.trim(),
      });
      const res = await fetch('https://huggingface.co/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...hfAuthHeader() },
        body: body.toString(), signal: c.signal,
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.access_token) return { ok: true, token: data.access_token };
      const err = data?.error;
      if (err === 'authorization_pending') continue;
      if (err === 'slow_down') { wait += 5000; continue; }
      if (err === 'access_denied') return { ok: false, error: 'Authorization denied! Run `!!connect login huggingface` again if this was a mistake.' };
      if (err === 'expired_token') return { ok: false, error: 'Code expired! Run `!!connect login huggingface` again.' };
      return { ok: false, error: data?.error_description || err || `Token request failed (${res.status})` };
    } catch (e) {
      if (e?.name === 'AbortError') continue;
      return { ok: false, error: e?.message || 'Failed' };
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, error: 'Timed out waiting! Run `!!connect login huggingface` again.' };
}

export function saveHFLogin(guildId, userId, token) {
  const p = AI_PROVIDERS.huggingface;
  setUserKey(String(guildId), String(userId), 'huggingface', p.baseUrl, token, p.defaultModel);
  return p.defaultModel;
}

// ---- Google login for Gemini (OAuth2 code flow + PKCE, refresh supported) ----

export function googleConfigured() {
  return !!(String(process.env.GOOGLE_CLIENT_ID || '').trim() && String(process.env.GOOGLE_CLIENT_SECRET || '').trim());
}

function googleRedirect() {
  const port = process.env.PORT || 3000;
  return `${(process.env.DASHBOARD_URL || `http://localhost:${port}`).replace(/\/+$/, '')}/api/oauth-callback`;
}

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/generative-language.retriever',
].join(' ');

export function startGoogleLogin(guildId, userId) {
  if (!googleConfigured()) {
    return { ok: false, error: 'Google login is not set up! Owner: create an OAuth client (Web app) with redirect <DASHBOARD_URL>/api/oauth-callback and set GOOGLE_CLIENT_ID/SECRET in .env.' };
  }
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));
  saveOAuthPending(String(guildId), String(userId), verifier, 'google');
  saveOAuthState(state, String(guildId), String(userId), 'google');
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID.trim(),
    redirect_uri: googleRedirect(),
    response_type: 'code', scope: GOOGLE_SCOPES, state,
    code_challenge: challenge, code_challenge_method: 'S256',
    access_type: 'offline', prompt: 'consent',
  });
  return { ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}` };
}

export async function finishGoogleLogin(code, state) {
  const s = consumeOAuthState(state);
  if (!s || s.provider !== 'google') return { ok: false, error: 'Invalid/expired login! Run `!!connect login google` again in Discord (10 min valid).' };
  const verifier = getOAuthPending(s.guild_id, s.user_id, 'google');
  if (!verifier) return { ok: false, error: 'Login expired! Run `!!connect login google` again.' };
  const r = await exchangeGoogleToken(code, verifier);
  if (!r.ok) return r;
  const data = r.data;
  setUserKey(s.guild_id, s.user_id, 'gemini', GEMINI_NATIVE_BASE, JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  }), 'gemini-2.0-flash');
  clearOAuthPending(s.guild_id, s.user_id);
  return { ok: true, model: 'gemini-2.0-flash' };
}

// Shared Google code exchange (AI login + dashboard login).
export async function exchangeGoogleToken(code, verifier, redirectUri = null) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 25000);
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code,
      redirect_uri: redirectUri || googleRedirect(),
      client_id: process.env.GOOGLE_CLIENT_ID.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET.trim(),
      code_verifier: verifier,
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(), signal: c.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.access_token) {
      return { ok: false, error: data?.error_description || data?.error || `Google exchange failed (${res.status})` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed' };
  } finally {
    clearTimeout(t);
  }
}

function dashboardBase() {
  const port = process.env.PORT || 3000;
  return (process.env.DASHBOARD_URL || `http://localhost:${port}`).replace(/\/+$/, '');
}

// Dashboard "Continue with Google": identity only (openid+email), allowlisted emails.
export function startDashboardGoogleLogin() {
  if (!googleConfigured()) {
    return { ok: false, error: 'Google login is not set up! Owner: set GOOGLE_CLIENT_ID/SECRET in .env.' };
  }
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));
  saveOAuthState(state, '-', '-', 'dashboard-google', verifier);
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID.trim(),
    redirect_uri: dashboardBase() + '/api/google-callback',
    response_type: 'code', scope: 'openid email', state,
    code_challenge: challenge, code_challenge_method: 'S256',
    access_type: 'offline', prompt: 'consent',
  });
  return { ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}` };
}

export async function finishDashboardGoogleLogin(code, state) {
  const s = consumeOAuthState(state);
  if (!s || s.provider !== 'dashboard-google' || !s.verifier) {
    return { ok: false, error: 'Invalid/expired login! Try again.' };
  }
  const r = await exchangeGoogleToken(code, s.verifier, dashboardBase() + '/api/google-callback');
  if (!r.ok) return r;
  const u = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${r.data.access_token}` },
  }).then(x => x.json().catch(() => null)).catch(() => null);
  const email = String(u?.email || '').toLowerCase();
  if (!email) return { ok: false, error: 'Could not read Google email!' };
  const allowed = String(process.env.GOOGLE_ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(email)) return { ok: false, error: `Not authorized! Ask the owner to add ${email} to GOOGLE_ALLOWED_EMAILS.` };
  return { ok: true, email };
}
