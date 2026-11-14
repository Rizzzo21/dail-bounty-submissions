#!/usr/bin/env bash
# Produce the demo material from a real run of the code: the transcript, the
# machine-readable trace, the SVG screenshot and (if ImageMagick is present)
# a PNG of the same transcript.
#
#   bash scripts/record.sh
set -e
cd "$(dirname "$0")/.."

node scripts/demo.mjs > docs/demo-transcript.txt
node scripts/demo.mjs --json > docs/demo-trace.json
cp docs/demo-transcript.txt docs/recording.txt
node scripts/screenshot.mjs > docs/demo-screenshot.svg

if command -v convert >/dev/null 2>&1; then
  # ImageMagick's policy blocks reading a file with the @ syntax, so the real
  # transcript is handed to it as an argument and annotated onto the canvas.
  TXT="$(cat docs/demo-transcript.txt)"
  convert -size 1100x700 xc:'#0b0f14' -font DejaVu-Sans-Mono -pointsize 12 \
          -fill '#d7e3f4' -annotate +18+20 "$TXT" docs/demo-screenshot.png
  echo "wrote docs/demo-screenshot.png"
else
  echo "ImageMagick not found - skipped the PNG (the SVG screenshot is still written)" >&2
fi

echo "demo material written:"
ls -l docs/
