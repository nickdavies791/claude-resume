#!/bin/sh
# Builds demo/demo.mp4 from fake sessions. Needs vhs, ffmpeg and Pillow.
set -e
cd "$(dirname "$0")/.."
DEMO=$(cd "$(mktemp -d)" && pwd -P)
python3 demo/make-sessions.py "$DEMO"
cat > demo/env.sh <<ENV
export HOME="$DEMO/home" CLAUDE_CONFIG_DIR="$DEMO/claude" XDG_CACHE_HOME="$DEMO/cache"
export CLAUDE_BIN="$PWD/demo/fake-claude.sh" PS1='\[\033[38;2;215;119;87m\]❯\[\033[0m\] '
alias cr="node $PWD/bin/claude-resume.js"
cd "\$HOME"
ENV
vhs demo/demo.tape
${PYTHON:-python3} demo/captions.py demo/raw.mp4 demo/demo.mp4
rm -rf "$DEMO" demo/env.sh demo/raw.mp4
