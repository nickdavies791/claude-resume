// Discovers and indexes Claude Code sessions stored under ~/.claude/projects.
// Each session is a JSONL transcript. We read only the head and tail of each
// file for metadata, and cache a plain-text extract for full-text search.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const CHUNK = 128 * 1024;
const CACHE_VERSION = 2;

export function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function cacheDir() {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'claude-resume');
}

async function readSlice(fd, start, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fd.read(buf, 0, length, start);
  return buf.subarray(0, bytesRead).toString('utf8');
}

function parseLines(text, { dropFirst = false, dropLast = false } = {}) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift();
  if (dropLast) lines.pop();
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* partial line */ }
  }
  return out;
}

// Turns a user message into a short, human-readable prompt, or null if it is
// not something the user actually typed (tool results, injected context).
export function promptText(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) return null;
  if (entry.origin && entry.origin.kind && entry.origin.kind !== 'human') return null;
  let content = entry.message?.content;
  if (Array.isArray(content)) {
    if (content.some(c => c.type === 'tool_result')) return null;
    content = content.filter(c => c.type === 'text').map(c => c.text).join(' ');
  }
  if (typeof content !== 'string' || !content.trim()) return null;
  const cmd = content.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = content.match(/<command-args>([^<]*)<\/command-args>/);
    return `${cmd[1].trim()} ${args ? args[1].trim() : ''}`.trim();
  }
  if (/^\s*<(local-command|system-reminder|bash-|user-memory)/.test(content)) return null;
  if (content.startsWith('Caveat:')) return null;
  return content.replace(/\s+/g, ' ').trim();
}

async function readMeta(file, stat) {
  const fd = await fsp.open(file, 'r');
  try {
    const head = parseLines(await readSlice(fd, 0, Math.min(CHUNK, stat.size)), { dropLast: stat.size > CHUNK });
    const tailStart = Math.max(0, stat.size - CHUNK);
    const tail = tailStart > 0
      ? parseLines(await readSlice(fd, tailStart, stat.size - tailStart), { dropFirst: true })
      : head;

    const meta = {
      id: path.basename(file, '.jsonl'),
      file,
      size: stat.size,
      mtime: stat.mtimeMs,
      cwd: null,
      branch: null,
      title: null,
      customTitle: null,
      firstPrompt: null,
      lastPrompt: null,
      created: null,
      updated: null,
    };

    for (const e of head) {
      if (!meta.cwd && e.cwd) meta.cwd = e.cwd;
      if (!meta.branch && e.gitBranch && e.gitBranch !== 'HEAD') meta.branch = e.gitBranch;
      if (!meta.created && e.timestamp) meta.created = Date.parse(e.timestamp);
      if (!meta.firstPrompt) meta.firstPrompt = promptText(e);
      if (e.type === 'custom-title' && e.customTitle) meta.customTitle = e.customTitle;
      if (e.type === 'ai-title' && e.aiTitle) meta.title = e.aiTitle;
      if (e.type === 'summary' && e.summary && !meta.title) meta.title = e.summary;
    }
    for (const e of tail) {
      if (e.cwd) meta.cwd = e.cwd;
      if (e.gitBranch && e.gitBranch !== 'HEAD') meta.branch = e.gitBranch;
      if (e.timestamp) meta.updated = Date.parse(e.timestamp);
      if (e.type === 'custom-title' && e.customTitle) meta.customTitle = e.customTitle;
      if (e.type === 'ai-title' && e.aiTitle) meta.title = e.aiTitle;
      if (e.type === 'last-prompt' && e.lastPrompt) meta.lastPrompt = e.lastPrompt;
      const p = promptText(e);
      if (p) meta.lastPrompt = p;
    }
    meta.updated = meta.updated || stat.mtimeMs;
    return meta;
  } finally {
    await fd.close();
  }
}

function loadCache(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.version === CACHE_VERSION ? data.sessions : {};
  } catch {
    return {};
  }
}

function saveCache(file, sessions) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: CACHE_VERSION, sessions }));
  } catch { /* cache is best effort */ }
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }));
  return results;
}

// Returns every resumable session, newest first.
export async function loadSessions() {
  const root = path.join(claudeHome(), 'projects');
  let dirs = [];
  try { dirs = await fsp.readdir(root, { withFileTypes: true }); } catch { return []; }

  const files = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    for (const f of await fsp.readdir(dir).catch(() => [])) {
      if (f.endsWith('.jsonl')) files.push(path.join(dir, f));
    }
  }

  const cacheFile = path.join(cacheDir(), 'sessions.json');
  const cache = loadCache(cacheFile);
  const next = {};

  const metas = await pool(files, 32, async file => {
    try {
      const stat = await fsp.stat(file);
      const hit = cache[file];
      const meta = hit && hit.size === stat.size && hit.mtime === stat.mtimeMs
        ? hit
        : await readMeta(file, stat);
      next[file] = meta;
      return meta;
    } catch {
      return null;
    }
  });

  saveCache(cacheFile, next);
  return metas
    .filter(m => m && m.cwd && (m.firstPrompt || m.title || m.customTitle))
    .sort((a, b) => b.updated - a.updated);
}

// ---- Full-text search -------------------------------------------------------

function extractText(raw) {
  const parts = [];
  for (const line of raw.split('\n')) {
    if (!line || (!line.includes('"type":"user"') && !line.includes('"type":"assistant"'))) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain) continue;
    const c = e.message?.content;
    if (typeof c === 'string') parts.push(c);
    else if (Array.isArray(c)) {
      for (const b of c) if (b.type === 'text' && b.text) parts.push(b.text);
    }
  }
  return parts.join('\n');
}

// Lazily builds a lowercase text index of every conversation. Extracts are
// cached on disk so only new or changed sessions are re-read.
export class TextIndex {
  constructor(sessions) {
    this.sessions = sessions;
    this.texts = new Map();
    this.ready = false;
    this.progress = 0;
  }

  async build(onProgress) {
    const dir = path.join(cacheDir(), 'text');
    await fsp.mkdir(dir, { recursive: true }).catch(() => {});
    let done = 0;
    await pool(this.sessions, 8, async s => {
      const key = crypto.createHash('sha1').update(`${s.file}:${s.size}:${s.mtime}`).digest('hex');
      const cached = path.join(dir, `${s.id}.${key.slice(0, 12)}.txt`);
      let text;
      try {
        text = await fsp.readFile(cached, 'utf8');
      } catch {
        try {
          text = extractText(await fsp.readFile(s.file, 'utf8')).toLowerCase();
          for (const old of await fsp.readdir(dir)) {
            if (old.startsWith(`${s.id}.`)) await fsp.unlink(path.join(dir, old)).catch(() => {});
          }
          await fsp.writeFile(cached, text).catch(() => {});
        } catch {
          text = '';
        }
      }
      this.texts.set(s.id, text);
      this.progress = ++done / this.sessions.length;
      onProgress?.(this.progress);
    });
    this.ready = true;
  }

  // Returns a short snippet around the first match, or null.
  match(id, terms) {
    const text = this.texts.get(id);
    if (!text) return null;
    let first = -1;
    for (const t of terms) {
      const i = text.indexOf(t);
      if (i < 0) return null;
      if (first < 0 || i < first) first = i;
    }
    const start = Math.max(0, first - 30);
    return (start > 0 ? '…' : '') + text.slice(start, first + 90).replace(/\s+/g, ' ').trim();
  }
}
