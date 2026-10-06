#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSessions, TextIndex } from '../src/sessions.js';
import { pick, filterSessions, prettyDir, relTime, titleOf } from '../src/ui.js';

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

const HELP = `claude-resume ${pkg.version}
Search and resume Claude Code sessions from any directory.

Usage
  cr [query] [options] [-- claude args]

Options
  -h, --here        Only sessions started in the current directory (or below)
  -f, --fork        Resume as a new session (claude --fork-session)
  -l, --list        Print matching sessions instead of opening the picker
      --json        Print matching sessions as JSON
  -p, --print       Print the resume command instead of running it
      --help        Show this help
  -v, --version     Show the version

Anything after -- is passed through to claude, e.g. cr -- --model opus

Keys
  type to search · ↑↓ navigate · enter resume · ctrl+f fork
  tab toggle this directory / all projects · esc clear or quit`;

function parseArgs(argv) {
  const opts = { query: [], here: false, fork: false, list: false, json: false, print: false, passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { opts.passthrough = argv.slice(i + 1); break; }
    else if (a === '-h' || a === '--here') opts.here = true;
    else if (a === '-f' || a === '--fork') opts.fork = true;
    else if (a === '-l' || a === '--list') opts.list = true;
    else if (a === '--json') opts.json = true;
    else if (a === '-p' || a === '--print') opts.print = true;
    else if (a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '-v' || a === '--version') { console.log(pkg.version); process.exit(0); }
    else if (a.startsWith('-')) { console.error(`Unknown option: ${a}\n\n${HELP}`); process.exit(2); }
    else opts.query.push(a);
  }
  opts.query = opts.query.join(' ');
  return opts;
}

const shellQuote = s => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;

function resumeArgs(session, opts, fork) {
  return ['--resume', session.id, ...(fork ? ['--fork-session'] : []), ...opts.passthrough];
}

function run(session, opts, fork) {
  const args = resumeArgs(session, opts, fork);
  if (opts.print) {
    console.log(`cd ${shellQuote(session.cwd)} && claude ${args.map(shellQuote).join(' ')}`);
    return;
  }
  process.stdout.write(`\x1b[2m Resuming \x1b[0m${titleOf(session)}\x1b[2m in ${prettyDir(session.cwd)}\x1b[0m\n`);
  const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { cwd: session.cwd, stdio: 'inherit' });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => {});
  child.on('error', err => {
    console.error(err.code === 'ENOENT' ? 'Could not find `claude` on your PATH.' : err.message);
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let sessions = await loadSessions();
  if (opts.here) {
    const cwd = process.cwd();
    sessions = sessions.filter(s => s.cwd === cwd || s.cwd.startsWith(cwd + path.sep));
  }

  if (opts.list || opts.json || !process.stdin.isTTY || !process.stdout.isTTY) {
    let index = null;
    if (opts.query) {
      index = new TextIndex(sessions);
      await index.build();
    }
    const results = filterSessions(sessions, opts.query, index);
    if (opts.json) {
      console.log(JSON.stringify(results.map(({ s, snippet }) => ({
        id: s.id, title: titleOf(s), cwd: s.cwd, branch: s.branch, updated: new Date(s.updated).toISOString(),
        firstPrompt: s.firstPrompt, lastPrompt: s.lastPrompt, file: s.file, ...(snippet ? { match: snippet } : {}),
      })), null, 2));
    } else {
      for (const { s } of results) {
        console.log(`${s.id}  ${relTime(s.updated).padEnd(9)} ${prettyDir(s.cwd).padEnd(32)} ${titleOf(s)}`);
      }
    }
    return;
  }

  if (!sessions.length) {
    console.log('No Claude Code sessions found.');
    return;
  }
  const choice = await pick(sessions, { query: opts.query, here: false });
  if (!choice) return;
  run(choice.session, opts, opts.fork || choice.fork);
}

main().catch(err => {
  process.stdout.write('\x1b[?25h');
  console.error(err);
  process.exit(1);
});
