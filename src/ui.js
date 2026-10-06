// Interactive picker styled after Claude Code's own /resume list.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { TextIndex } from './sessions.js';

const ESC = '\x1b[';
const color = process.env.NO_COLOR ? () => s => s : (open, close = 39) => s => `${ESC}${open}m${s}${ESC}${close}m`;
const c = {
  accent: color('38;2;215;119;87'), // Claude orange
  dim: color(2, 22),
  bold: color(1, 22),
  green: color(32),
  red: color(31),
  yellow: color(33),
  inverse: color(7, 27),
};

export function prettyDir(dir) {
  const home = os.homedir();
  return dir === home ? '~' : dir.startsWith(home + path.sep) ? '~' + dir.slice(home.length) : dir;
}

export function relTime(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const units = [[60, 'm'], [24, 'h'], [7, 'd'], [4.35, 'w'], [12, 'mo'], [Infinity, 'y']];
  let v = s / 60;
  let unit = 'm';
  for (const [div, u] of units) {
    unit = u;
    if (v < div) break;
    v /= div;
  }
  return `${Math.floor(v)}${unit} ago`;
}

export function fmtSize(b) {
  return b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

export function titleOf(s) {
  return s.customTitle || s.title || s.firstPrompt || '(untitled)';
}

// Display width aware truncation (treats wide CJK/emoji as 2 columns).
function width(ch) {
  const cp = ch.codePointAt(0);
  return cp > 0x1100 && /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
}

const strip = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const visible = s => [...strip(s)].reduce((w, ch) => w + width(ch), 0);

function truncate(str, max) {
  if (max <= 0) return '';
  if (visible(str) <= max) return str;
  let w = 0;
  let out = '';
  for (const ch of str) {
    if (w + width(ch) > max - 1) break;
    out += ch;
    w += width(ch);
  }
  return out + '…';
}

// Lays out left and right aligned text on one line.
function spread(left, right, cols) {
  return left + ' '.repeat(Math.max(1, cols - visible(left) - visible(right) - 1)) + right;
}

function haystack(s) {
  return [s.customTitle, s.title, s.firstPrompt, s.lastPrompt, prettyDir(s.cwd), s.cwd, s.branch, s.id]
    .filter(Boolean).join('\n').toLowerCase();
}

export function filterSessions(sessions, query, index) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return sessions.map(s => ({ s }));
  const meta = [];
  const content = [];
  for (const s of sessions) {
    s._hay ??= haystack(s);
    if (terms.every(t => s._hay.includes(t))) meta.push({ s });
    else if (index) {
      const snippet = index.match(s.id, terms);
      if (snippet) content.push({ s, snippet });
    }
  }
  return meta.concat(content);
}

export function pick(allSessions, { query = '', here = false } = {}) {
  return new Promise(resolve => {
    const { stdin, stdout } = process;
    const cwd = process.cwd();
    const index = new TextIndex(allSessions);
    let state = { query, here, sel: 0, scroll: 0, message: null };
    let results = [];

    const scoped = () => state.here
      ? allSessions.filter(s => s.cwd === cwd || s.cwd.startsWith(cwd + path.sep))
      : allSessions;
    const refilter = () => {
      results = filterSessions(scoped(), state.query, index.ready || index.progress > 0 ? index : null);
      state.sel = Math.min(state.sel, Math.max(0, results.length - 1));
    };

    const itemHeight = r => (r.snippet ? 3 : 2);

    const render = () => {
      const cols = stdout.columns || 80;
      const rows = stdout.rows || 24;
      const out = [];
      const scopeLabel = state.here ? prettyDir(cwd) : 'all projects';
      const count = `${results.length} of ${scoped().length}`;
      const indexing = !index.ready ? c.dim(` · indexing ${Math.round(index.progress * 100)}%`) : '';
      out.push('');
      out.push(spread(` ${c.accent(c.bold('Resume Session'))} ${c.dim('·')} ${scopeLabel}`, c.dim(count) + indexing, cols));
      const box = Math.max(10, cols - 4);
      const placeholder = 'Search titles, prompts, directories and conversation text…';
      const q = state.query
        ? truncate(state.query, box - 5)
        : c.dim(truncate(placeholder, box - 5));
      out.push(c.dim(` ╭${'─'.repeat(box)}╮`));
      out.push(spread(` ${c.dim('│')} ${c.accent('⌕')} ${q}${state.query ? c.inverse(' ') : ''}`, c.dim('│'), cols));
      out.push(c.dim(` ╰${'─'.repeat(box)}╯`));

      const listRows = rows - out.length - 3;
      // Keep the selection in view.
      if (state.sel < state.scroll) state.scroll = state.sel;
      let used = 0;
      for (let i = state.scroll; i <= state.sel && i < results.length; i++) used += itemHeight(results[i]);
      while (used > listRows && state.scroll < state.sel) used -= itemHeight(results[state.scroll++]);

      let h = 0;
      if (!results.length) {
        out.push('', c.dim(state.query ? (index.ready ? '   No matching sessions' : '   No matches yet, still indexing conversations…') : '   No sessions found'));
        h = 2;
      }
      for (let i = state.scroll; i < results.length; i++) {
        const r = results[i];
        if (h + itemHeight(r) > listRows) break;
        const s = r.s;
        const active = i === state.sel;
        const pointer = active ? c.accent('❯') : ' ';
        const title = truncate(titleOf(s), cols - 5);
        out.push(` ${pointer} ${active ? c.accent(c.bold(title)) : title}`);
        const missing = !fs.existsSync(s.cwd);
        const bits = [relTime(s.updated), prettyDir(s.cwd) + (missing ? ' (missing)' : '')];
        if (s.branch) bits.push(s.branch);
        bits.push(fmtSize(s.size));
        const line = truncate(bits.join(' · '), cols - 5);
        out.push(`   ${missing ? c.red(line) : c.dim(line)}`);
        if (r.snippet) out.push(`   ${c.yellow(truncate('“' + r.snippet + '”', cols - 5))}`);
        h += itemHeight(r);
      }
      while (h++ < listRows) out.push('');

      const cur = results[state.sel]?.s;
      const msg = state.message
        ? c.red(state.message)
        : cur ? c.dim(truncate(`Last: ${cur.lastPrompt || cur.firstPrompt || ''}`, cols - 4)) : '';
      out.push(` ${msg}`);
      out.push(c.dim(` ↑↓ navigate · enter resume · ctrl+f fork · tab ${state.here ? 'all projects' : 'this directory'} · esc ${state.query ? 'clear' : 'quit'}`));

      stdout.write(`${ESC}H` + out.map(l => `${l}${ESC}K`).join('\n') + `${ESC}J`);
    };

    let pending = false;
    let closed = false;
    const schedule = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; if (!closed) render(); }, 16);
    };

    const finish = value => {
      closed = true;
      stdin.off('data', onKey);
      stdout.off('resize', schedule);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      stdout.write(`${ESC}?25h${ESC}?1049l`);
      resolve(value);
    };

    const choose = fork => {
      const s = results[state.sel]?.s;
      if (!s) return;
      if (!fs.existsSync(s.cwd)) {
        state.message = `Directory no longer exists: ${s.cwd}`;
        return render();
      }
      finish({ session: s, fork });
    };

    const move = d => {
      state.sel = Math.max(0, Math.min(results.length - 1, state.sel + d));
      state.message = null;
      render();
    };

    const onKey = buf => {
      const k = buf.toString();
      if (k === '\x03') return finish(null); // ctrl+c
      if (k === '\x1b') {
        if (state.query) { state.query = ''; state.sel = 0; refilter(); return render(); }
        return finish(null);
      }
      if (k === '\r' || k === '\n') return choose(false);
      if (k === '\x06') return choose(true); // ctrl+f
      if (k === '\x1b[A' || k === '\x10' || k === '\x1bOA') return move(-1);
      if (k === '\x1b[B' || k === '\x0e' || k === '\x1bOB') return move(1);
      if (k === '\x1b[5~') return move(-10);
      if (k === '\x1b[6~') return move(10);
      if (k === '\x1b[H' || k === '\x1b[1~') return move(-Infinity);
      if (k === '\x1b[F' || k === '\x1b[4~') return move(Infinity);
      if (k === '\t') { state.here = !state.here; state.sel = 0; state.scroll = 0; refilter(); return render(); }
      if (k === '\x7f' || k === '\b') {
        state.query = [...state.query].slice(0, -1).join('');
      } else if (k === '\x15') { // ctrl+u
        state.query = '';
      } else if (k === '\x17') { // ctrl+w
        state.query = state.query.replace(/\S+\s*$/, '');
      } else if (k.startsWith('\x1b') || k.charCodeAt(0) < 32) {
        return;
      } else {
        state.query += k.replace(/[\r\n]/g, ' ');
      }
      state.sel = 0;
      state.scroll = 0;
      state.message = null;
      refilter();
      render();
    };

    stdout.write(`${ESC}?1049h${ESC}?25l`);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onKey);
    stdout.on('resize', schedule);
    refilter();
    render();

    let last = 0;
    index.build(() => {
      // Re-run the search as more conversations become searchable.
      if (!closed && Date.now() - last > 150) { last = Date.now(); refilter(); schedule(); }
    }).then(() => { if (!closed) { refilter(); schedule(); } });
  });
}
