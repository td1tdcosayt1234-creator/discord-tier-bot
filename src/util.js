// Shared security helpers.
import { lookup } from 'node:dns/promises';

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ipv4Blocked(p) {
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // cloud metadata
  if (a === 0) return true;
  return false; // 100.64/10 (CGNAT incl. Tailscale) allowed on purpose
}

function ipv6Blocked(ip) {
  const h = ip.toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80:') || h.startsWith('fec0:')) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h)) return true;
  return false;
}

function isIpLiteral(host) {
  return /^[0-9a-fA-F:.]+$/.test(host) && (host.includes('.') || host.includes(':'));
}

// Fail-closed SSRF guard: only public http(s), no creds in URL,
// no localhost/internal/metadata hosts. DNS-resolved IPs must be public.
export async function isPublicHttpUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const port = Number(u.port);
  if (port && (port < 1 || port > 65535)) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return false;
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length) return false;
    for (const { address } of addrs) {
      if (isIpLiteral(address) === false) continue;
      if (address.includes(':')) { if (ipv6Blocked(address)) return false; }
      else {
        const parts = address.split('.').map(Number);
        if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
        if (ipv4Blocked(parts)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export const SSRF_ERROR = 'URL blocked! Only public http(s) hosts allowed (no localhost/internal/cloud-metadata).';

// Mass/role mentions that must never be stored or echoed (ping abuse).
export function hasBadMentions(s) {
  return /@everyone|@here|<@&/.test(String(s || ''));
}

// ---- Encrypted secrets at rest (AES-256-GCM). ----
// New writes are encrypted; reads transparently decrypt, with fallback to
// legacy plaintext rows. Key derived from server env (never stored in DB).
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

function sealKey() {
  const secret = process.env.SESSION_SECRET || process.env.DASHBOARD_KEY || process.env.ADMIN_PASS || 'change-me';
  return scryptSync(String(secret), 'tierbot-seal-v1', 32);
}

export function sealSecret(plain) {
  if (plain == null || plain === '') return plain;
  const s = String(plain);
  if (s.startsWith('enc1.')) return s; // already sealed
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey(), iv);
  const ct = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc1.${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`;
}

export function openSecret(stored) {
  if (stored == null || stored === '') return stored;
  const s = String(stored);
  if (!s.startsWith('enc1.')) return s; // legacy plaintext row
  try {
    const [, ivB, ctB, tagB] = s.split('.');
    const decipher = createDecipheriv('aes-256-gcm', sealKey(), Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null; // tampered or key rotated: treat as missing, never as plaintext
  }
}
