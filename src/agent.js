// AI coding agent (!ai coding on): the model gets ONLY these tools —
// file read/create/list (sandboxed to ./workspace/<server-id>/), zip/unzip, MCP.
// No shell, no delete, no network fetch. Works with OpenAI-compatible
// endpoints (user OAuth keys like github/openrouter/huggingface, or server custom keys).
// Google-native OAuth logins (Gemini generateContent) are NOT supported here.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, lstatSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { getUserKey, getAIConfigFull, getMcpServer, listMcpServers } from './db.js';
import { listMcpTools, callMcpTool } from './mcp.js';

const __root = join(dirname(fileURLToPath(import.meta.url)), '..', 'workspace');
const MAX_STEPS = 6;
const CALL_TIMEOUT_MS = 45000;
const MAX_FILE_BYTES = 1024 * 1024; // 1 MB per file
const MAX_TOOL_TEXT = 4000;

function massMention(s) {
  return /@everyone|@here|<@&/.test(String(s || ''));
}

// Resolve a workspace-relative path. Returns { ok, abs?, rel?, error? }
export function resolvePath(guildId, raw) {
  let p = String(raw || '').trim().replace(/\\/g, '/');
  if (!p || p.length > 200) return { ok: false, error: 'Bad path! Use a short relative path like `notes/hello.txt`.' };
  if (p.includes('\0') || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.startsWith('~')) {
    return { ok: false, error: 'Only workspace-relative paths allowed! No absolute paths.' };
  }
  const abs = normalize(join(__root, String(guildId), p));
  const base = normalize(join(__root, String(guildId))) + sep;
  if (abs !== base.slice(0, -1) && !abs.startsWith(base)) {
    return { ok: false, error: 'Path escapes the workspace! No `..` tricks.' };
  }
  const rel = (abs.slice(base.length) || '.').split(sep).join('/');
  return { ok: true, abs, rel };
}

function toolResult(text) {
  return String(text ?? '').slice(0, MAX_TOOL_TEXT);
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file from the workspace. Path is relative, e.g. notes/hello.txt.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create (or overwrite) a text file in the workspace. Parent folders are made automatically. Max 1MB.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in a workspace folder (default: root).',
      parameters: { type: 'object', properties: { dir: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'zip_files',
      description: 'Zip workspace files into an output .zip (e.g. files: ["a.txt","img/"], out: "pack.zip").',
      parameters: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' } },
          out: { type: 'string' },
        },
        required: ['files', 'out'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unzip_file',
      description: 'Unzip a workspace .zip into a folder (default: same folder as the zip).',
      parameters: {
        type: 'object',
        properties: { file: { type: 'string' }, dir: { type: 'string' } },
        required: ['file'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mcp_tools',
      description: 'List tools of a connected MCP server on this Discord server.',
      parameters: { type: 'object', properties: { server: { type: 'string' } }, required: ['server'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mcp_call',
      description: 'Call an MCP server tool. args is a JSON object string, e.g. {"q":"hi"}.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string' },
          tool: { type: 'string' },
          args: { type: 'string' },
        },
        required: ['server', 'tool'],
      },
    },
  },
];

export async function execTool(name, args, guildId) {
  const a = args && typeof args === 'object' ? args : {};
  const noSymlink = abs => {
    try {
      if (lstatSync(abs).isSymbolicLink()) return true;
    } catch { /* not existing yet */ }
    return false;
  };
  try {
    if (name === 'read_file') {
      const r = resolvePath(guildId, a.path);
      if (!r.ok) return r.error;
      if (noSymlink(r.abs)) return 'Blocked: symlinks not allowed!';
      let st;
      try { st = statSync(r.abs); } catch { return 'File not found!'; }
      if (!st.isFile()) return 'Not a file! Use list_files for folders.';
      if (st.size > MAX_FILE_BYTES) return 'File too big (>1MB)!';
      return toolResult(readFileSync(r.abs, 'utf8'));
    }
    if (name === 'create_file') {
      const r = resolvePath(guildId, a.path);
      if (!r.ok) return r.error;
      if (noSymlink(r.abs)) return 'Blocked: symlinks not allowed!';
      const content = String(a.content ?? '');
      if (Buffer.byteLength(content) > MAX_FILE_BYTES) return 'Content too big (>1MB)! Split into smaller files.';
      if (massMention(content)) return 'Blocked: no @everyone/@here/role mentions in files!';
      try {
        let st;
        try { st = statSync(r.abs); } catch { st = null; }
        if (st && st.isDirectory()) return 'A folder exists there! Pick a file path.';
        mkdirSync(dirname(r.abs), { recursive: true });
        writeFileSync(r.abs, content);
        return `Saved ${r.rel} (${Buffer.byteLength(content)} bytes).`;
      } catch (e) {
        return `Write failed: ${e.message}`;
      }
    }
    if (name === 'list_files') {
      const r = resolvePath(guildId, a.dir || '.');
      if (!r.ok) return r.error;
      const target = r.rel === '.' ? join(__root, String(guildId)) : r.abs;
      let entries;
      try { entries = readdirSync(target, { withFileTypes: true }); }
      catch { return 'Folder not found (empty workspace?)!'; }
      const out = entries.slice(0, 50).map(e => `${e.isDirectory() ? '📁 ' : '📄 '}${e.name}`);
      return toolResult(out.join('\n') || '(empty)') + (entries.length > 50 ? `\n…+${entries.length - 50} more` : '');
    }
    if (name === 'zip_files') {
      const files = Array.isArray(a.files) ? a.files : [];
      if (!files.length || files.length > 20) return 'Give 1-20 files!';
      let out = String(a.out || '').trim();
      if (!out) return 'Missing out! Example out: "pack.zip".';
      if (!out.toLowerCase().endsWith('.zip')) out += '.zip';
      const ro = resolvePath(guildId, out);
      if (!ro.ok) return ro.error;
      if (noSymlink(ro.abs)) return 'Blocked: symlinks not allowed!';
      const zip = new AdmZip();
      let total = 0;
      const seen = new Set();
      for (const f of files.slice(0, 20)) {
        const r = resolvePath(guildId, f);
        if (!r.ok) return `${f}: ${r.error}`;
        if (seen.has(r.abs)) continue;
        seen.add(r.abs);
        if (noSymlink(r.abs)) return `${f}: symlinks blocked!`;
        let st;
        try { st = statSync(r.abs); } catch { return `${f}: not found!`; }
        if (st.isDirectory()) {
          // cap directory zip: walk and sum, max 50 files / 100MB
          const stack = [r.abs];
          let count = 0;
          while (stack.length && count < 50) {
            const d = stack.pop();
            let ents;
            try { ents = readdirSync(d, { withFileTypes: true }); } catch { break; }
            for (const e of ents) {
              const p = join(d, e.name);
              if (noSymlink(p)) return `${f}: symlink inside folder blocked!`;
              if (e.isDirectory()) stack.push(p);
              else if (e.isFile()) {
                let s2;
                try { s2 = statSync(p); } catch { continue; }
                total += s2.size;
                if (total > 100 * 1024 * 1024) return 'Total too big (>100MB)! Zip fewer files.';
                count++;
                if (count > 50) return 'Folder too many files (>50)!';
              }
            }
          }
          zip.addLocalFolder(r.abs, r.rel);
        } else {
          if (st.size > 20 * 1024 * 1024) return `${f}: file too big for zip (>20MB)!`;
          total += st.size;
          if (total > 100 * 1024 * 1024) return 'Total too big (>100MB)! Zip fewer files.';
          zip.addFile(r.rel, readFileSync(r.abs));
        }
      }
      mkdirSync(dirname(ro.abs), { recursive: true });
      zip.writeZip(ro.abs);
      return `Zipped ${files.length} item(s) -> ${ro.rel}. Download: !get ${ro.rel}`;
    }
    if (name === 'unzip_file') {
      const r = resolvePath(guildId, a.file);
      if (!r.ok) return r.error;
      if (noSymlink(r.abs)) return 'Blocked: symlinks not allowed!';
      if (!existsSync(r.abs)) return 'Zip not found!';
      let zipSize = 0;
      try { zipSize = statSync(r.abs).size; } catch { return 'Zip not found!'; }
      if (zipSize > 50 * 1024 * 1024) return 'Zip too big (>50MB)!';
      const defaultDir = dirname(r.rel) === '.' ? '.' : dirname(r.rel);
      const dest = resolvePath(guildId, a.dir || defaultDir);
      if (!dest.ok) return dest.error;
      let zip;
      try { zip = new AdmZip(r.abs); } catch { return 'Invalid zip file!'; }
      const entries = zip.getEntries();
      if (entries.length > 500) return 'Zip has too many files (>500)!';
      let uncompressed = 0;
      for (const e of entries) {
        const n = e.entryName.replace(/\\/g, '/');
        if (!n || n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.split('/').includes('..')) {
          return `Unsafe zip entry blocked: ${n.slice(0, 80)}`;
        }
        uncompressed += e.header?.size || 0;
        if (uncompressed > 100 * 1024 * 1024) return 'Uncompressed too big (>100MB)!';
      }
      const target = dest.rel === '.' ? join(__root, String(guildId)) : dest.abs;
      mkdirSync(target, { recursive: true });
      zip.extractAllTo(target, true);
      return `Unzipped ${r.rel} -> ${dest.rel || '.'}.`;
    }
    if (name === 'mcp_tools') {
      const sname = String(a.server || '').trim().toLowerCase();
      if (!sname) {
        const rows = listMcpServers(String(guildId));
        return rows.length ? `Servers: ${rows.map(r => r.name).join(', ')}` : 'No MCP servers! Ask a mod to add one: /mcp add.';
      }
      const srv = getMcpServer(String(guildId), sname);
      if (!srv) return `Server "${sname}" not found!`;
      const t = await listMcpTools(srv);
      if (!t.ok) return `MCP error: ${t.error}`;
      if (!t.tools.length) return 'No tools on this server!';
      return toolResult(t.tools.map(t2 => `• ${t2.name} — ${t2.description || ''}`).join('\n'));
    }
    if (name === 'mcp_call') {
      const sname = String(a.server || '').trim().toLowerCase();
      const tname = String(a.tool || '').trim();
      if (!sname || !tname) return 'Need server + tool! Use mcp_tools first to discover.';
      const srv = getMcpServer(String(guildId), sname);
      if (!srv) return `Server "${sname}" not found!`;
      let pargs = undefined;
      if (typeof a.args === 'string' && a.args.trim()) {
        try { pargs = JSON.parse(a.args); } catch { return 'args must be valid JSON! Example: {"q":"hi"}'; }
      } else if (a.args && typeof a.args === 'object') pargs = a.args;
      const r = await callMcpTool(srv, tname, pargs);
      if (!r.ok) return `MCP error: ${r.error}`;
      return toolResult(r.text);
    }
    return `Unknown tool: ${name}`;
  } catch (e) {
    return `Tool failed: ${e?.message || e}`;
  }
}

function pickCreds(guildId, userId) {
  const uk = getUserKey(String(guildId), String(userId));
  if (uk?.api_key) {
    const nativeGemini = uk.provider === 'gemini' && /\/v1beta\/?$/.test(String(uk.base_url || ''));
    if (!nativeGemini) {
      return { ok: true, baseUrl: uk.base_url, apiKey: uk.api_key, model: uk.model, provider: uk.provider };
    }
  }
  const cfg = getAIConfigFull(String(guildId));
  if (cfg.mode === 'custom' && cfg.baseUrl && cfg.apiKey) {
    return { ok: true, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, provider: cfg.provider };
  }
  if (uk?.api_key) {
    return {
      ok: false,
      error: 'Coding mode needs an OpenAI-compatible login! Google-native logins work for chat only. Run `!!connect login github` (no key needed), then `!ai coding on` again.',
    };
  }
  return { ok: false, error: 'Coding mode needs an AI endpoint! Run `!!connect login github` (no key) or ask a mod for a key.' };
}

async function chatOnce({ baseUrl, apiKey, model, provider, messages }) {
  let base = String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  try { const u = new URL(base); if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Bad endpoint' }; }
  catch { return { ok: false, error: 'Bad endpoint' }; }
  const { isPublicHttpUrl } = await import('./util.js');
  if (!(await isPublicHttpUrl(base))) return { ok: false, error: 'Endpoint blocked (private URL)!' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://discord-tier-bot/';
      headers['X-Title'] = 'Discord Tier Bot';
    }
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: model || 'gpt-3.5-turbo', messages, tools: TOOLS, tool_choice: 'auto' }),
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'API key rejected (401/403)! Re-login: `!!connect login`.' };
      if (res.status === 404) return { ok: false, error: 'Model not found (404)! Change it with `!!connect model <name>`.' };
      if (res.status === 429) return { ok: false, error: 'Rate limit / no credit (429)!' };
      const t = await res.text().catch(() => '');
      if (/tools/i.test(t) && /support|invalid|unknown/i.test(t)) return { ok: false, toolsUnsupported: true, error: t.slice(0, 200) };
      return { ok: false, error: t.slice(0, 200) || `AI failed (${res.status})` };
    }
    const data = await res.json().catch(() => null);
    const msg = data?.choices?.[0]?.message;
    if (!msg) return { ok: false, error: 'Empty response from AI' };
    return { ok: true, message: msg };
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'AI timed out, try again!' : (e?.message || 'Request failed') };
  } finally {
    clearTimeout(timeout);
  }
}

const SYSTEM = `You are a coding agent inside Discord. You have ONLY these tools: read_file, create_file, list_files, zip_files, unzip_file, mcp_tools, mcp_call. No shell, no delete, no web fetch.
Workspace: server-private folder, paths like notes/hello.txt (use list_files to explore, read before editing).
Rules: answer DIRECTLY with no tools when the user just chats or asks a question — create files ONLY when the user asked for a file/deliverable or the task truly needs it. Keep chat replies SHORT (Discord cuts at ~1900 chars); explain briefly what you did + file paths. After create/zip, tell the exact !get path. If a tool errors, try once differently, then report.`;

// True when this user has an OpenAI-compatible endpoint (own login or server key).
export function hasAgentEndpoint(guildId, userId) {
  return pickCreds(guildId, userId).ok;
}
// Returns { ok, text?, files?, error?, needAuth? } — same shape as askAI.
export async function runAgent(prompt, guildId, userId, history = []) {
  const clean = String(prompt || '').trim().slice(0, 1000);
  if (!clean) return { ok: false, error: 'Please give me a task!' };
  const creds = pickCreds(guildId, userId);
  if (!creds.ok) return creds;
  const { saveExchange } = await import('./db.js');
  const remember = text => { try { if (text) saveExchange(String(guildId), String(userId), clean, text); } catch { /* ignore */ } };
  const past = Array.isArray(history) ? history.filter(m => m?.role && m?.content).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 1500),
  })) : [];
  const messages = [
    { role: 'system', content: SYSTEM },
    ...past,
    { role: 'user', content: clean },
  ];
  const files = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await chatOnce({ ...creds, messages });
    if (!r.ok) {
      if (r.toolsUnsupported && step === 0) {
        return { ok: false, error: 'This AI endpoint does not support tools! Try `!!connect login github` or another OpenAI-compatible key.' };
      }
      if (step === 0) return { ok: false, error: r.error };
      messages.push({ role: 'user', content: `(tool step failed: ${r.error}) Summarize what you did so far.` });
      continue;
    }
    const msg = r.message;
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter(c => c?.type === 'function') : [];
    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls.length ? calls.map(c => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments } })) : undefined });
    if (!calls.length) {
      const text = sanitizeAgent(String(msg.content || '').trim());
      remember(text);
      return { ok: true, text: text || '(done — no reply text)', files, mode: 'coding', provider: creds.provider };
    }
    for (const c of calls.slice(0, 5)) {
      const toolName = c.function?.name;
      let pargs = {};
      try { pargs = JSON.parse(c.function?.arguments || '{}'); } catch { pargs = {}; }
      const out = await execTool(toolName, pargs, guildId);
      if (typeof out === 'string' && /^(Saved|Zipped)/.test(out)) {
        const p = toolName === 'zip_files'
          ? String(pargs.out || '').replace(/\\/g, '/').trim()
          : String(pargs.path || '').replace(/\\/g, '/').trim();
        if (p && !files.includes(p)) files.push(p.length > 120 ? p.slice(0, 120) : p);
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: String(out).slice(0, MAX_TOOL_TEXT) });
    }
  }
  // Out of steps: force a summary from what we have.
  const r = await chatOnce({ ...creds, messages: [...messages, { role: 'user', content: 'You are out of tool steps. Summarize results + file paths briefly.' }] });
  if (r.ok && r.message?.content) {
    const text = sanitizeAgent(String(r.message.content).slice(0, 1900));
    remember(text);
    return { ok: true, text, files, mode: 'coding', provider: creds.provider };
  }
  const created = messages.filter(m => m.role === 'tool').length;
  return { ok: true, text: sanitizeAgent(`Done ${created} tool step(s). Files: ${files.join(', ') || 'see !ai files'}.`), files, mode: 'coding', provider: creds.provider };
}

function sanitizeAgent(s) {
  return String(s || '')
    .replace(/@everyone/gi, '@\u200beveryone')
    .replace(/@here/gi, '@\u200bhere')
    .replace(/<@&(\d+)>/g, '<@\u200b&$1>');
}

// Files created/touched this session (for the reply summary).
export function workspaceFiles(guildId) {
  const dir = join(__root, String(guildId));
  const out = [];
  const walk = (d, rel) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.slice(0, 200)) {
      const rp = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), rp);
      else if (out.length < 200) out.push(rp);
    }
  };
  walk(dir, '');
  return out;
}

// Admin file browser helpers (sandboxed to the guild workspace).
export function workspaceFileInfo(guildId, raw) {
  const r = resolvePath(guildId, raw);
  if (!r.ok) return r;
  let st;
  try { st = statSync(r.abs); } catch { return { ok: false, error: 'File not found!' }; }
  if (!st.isFile()) return { ok: false, error: 'Not a file!' };
  return { ok: true, abs: r.abs, rel: r.rel, size: st.size };
}

export function workspaceDeleteFile(guildId, raw) {
  const r = resolvePath(guildId, raw);
  if (!r.ok) return r;
  try {
    const st = statSync(r.abs);
    if (!st.isFile()) return { ok: false, error: 'Only files can be deleted (no folders)!' };
    rmSync(r.abs);
    return { ok: true, rel: r.rel };
  } catch {
    return { ok: false, error: 'Delete failed / not found!' };
  }
}
