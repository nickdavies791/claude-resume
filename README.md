# claude-resume

Search and resume [Claude Code](https://claude.com/claude-code) sessions from **any directory**.

`claude --resume` only lists sessions for the directory you're in. If you can't remember where you started a conversation, `cr` finds it, switches to the right directory and resumes it.

```
 Resume Session · all projects                                    7 of 110
 ╭────────────────────────────────────────────────────────────────────────╮
 │ ⌕ webhook                                                              │
 ╰────────────────────────────────────────────────────────────────────────╯
 ❯ Fix duplicate Stripe webhook deliveries
   2d ago · ~/Code/billing-api · fix/webhook-retries · 303 KB
   Payments dashboard refactor
   1w ago · ~/Code/web · main · 269 KB
   “…the webhook handler should be idempotent, so store the event id befor…”
 ↑↓ navigate · enter resume · ctrl+f fork · tab this directory · esc clear
```

## Install

```sh
npm install -g claude-resume   # once published
# or from a clone
git clone <repo> && cd claude-resume && npm link
```

Requires Node 18+. No dependencies.

## Usage

```sh
cr                  # pick from every session, newest first
cr invoice bug      # start with a search
cr --here           # only sessions from this directory (and below)
cr --fork           # resume as a new session (--fork-session)
cr -l auth          # print matches instead of opening the picker
cr --json auth      # machine-readable output
cr -p               # print `cd <dir> && claude --resume <id>` instead of running it
cr -- --model opus  # pass extra flags through to claude
```

Search matches session titles, your first and last prompts, directory, git branch and session ID instantly. It also searches the full text of every conversation; matches found there appear below the others with a snippet.

### Keys

| Key | Action |
| --- | --- |
| type | search |
| ↑ ↓ / ctrl+p ctrl+n | navigate |
| enter | resume |
| ctrl+f | resume as a fork |
| tab | toggle this directory / all projects |
| esc | clear search, then quit |

### Leaving your shell in the session's directory

`cr` runs Claude in the session's directory, then returns you to where you were. To stay in that directory afterwards, add this to your `~/.zshrc` or `~/.bashrc`:

```sh
cr() { local cmd; cmd=$(command cr --print "$@") && [ -n "$cmd" ] && eval "$cmd"; }
```

## How it works

Claude Code stores each session as a JSONL file in `~/.claude/projects/<encoded-path>/<session-id>.jsonl` (or `$CLAUDE_CONFIG_DIR/projects`). `cr` reads the start and end of each file for its title, directory, branch and prompts, then runs `claude --resume <id>` in the session's directory.

It only reads your transcripts; it never changes them. Metadata and a text-only extract for search are cached in `~/.cache/claude-resume` (or `$XDG_CACHE_HOME/claude-resume`), so later runs are fast. Delete that folder at any time.

| Variable | Purpose |
| --- | --- |
| `CLAUDE_CONFIG_DIR` | Where Claude Code keeps its data (default `~/.claude`) |
| `CLAUDE_BIN` | The claude executable to run (default `claude`) |
| `NO_COLOR` | Turn off colour |

## Licence

MIT
