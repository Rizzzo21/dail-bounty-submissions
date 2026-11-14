#!/usr/bin/env bash
# Record a demo run for the human X post.
#
#   bash scripts/record.sh            # -> docs/recording.txt (+ .cast if asciinema exists)
#   bash scripts/record.sh out.cast   # -> an asciinema cast file
#
# Produces two artifacts:
#   docs/recording.txt  the plain transcript (always)
#   docs/recording.cast an asciinema cast (only if `asciinema` is installed)
#
# The script is deterministic: the same seed always records the same transcript.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

SEED="${SEED:-near-swarm-2026}"
OUT="${1:-}"

mkdir -p docs

echo "recording demo with seed=$SEED ..."
node scripts/demo.mjs --seed "$SEED" | tee docs/recording.txt >/dev/null
echo "wrote docs/recording.txt ($(wc -l < docs/recording.txt) lines)"

if command -v asciinema >/dev/null 2>&1; then
  TARGET="${OUT:-docs/recording.cast}"
  echo "asciinema found -- recording $TARGET"
  asciinema rec --overwrite -c "node scripts/demo.mjs --seed $SEED" "$TARGET"
  echo "wrote $TARGET"
  echo
  echo "to render it as a GIF:"
  echo "  asciinema play $TARGET"
  echo "  # then: agg --rows 40 --cols 100 $TARGET > demo.gif"
else
  echo "asciinema is not installed -- skipping the .cast recording."
  echo "install it with:  npm i -g asciinema   (or: brew install asciinema)"
  echo "the plain transcript in docs/recording.txt is already a complete artifact."
fi

echo
echo "For screenshots of a terminal, run the demo in any terminal and capture it:"
echo "  node scripts/demo.mjs | tee docs/recording.txt"
echo "  # macOS:  CMD+SHIFT+4  /  Linux:  gnome-screenshot -f docs/demo.png"
