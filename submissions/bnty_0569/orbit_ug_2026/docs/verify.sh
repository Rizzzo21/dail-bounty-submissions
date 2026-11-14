#!/usr/bin/env bash
set -euo pipefail
node --test test/engine.test.mjs
out1="$(node scripts/demo.mjs)"
out2="$(node scripts/demo.mjs)"
if [ "$out1" != "$out2" ]; then
  echo "Determinism check failed"
  exit 1
fi
# the published diagram PNG must not be a clipped render of the SVG
node scripts/check-diagram-png.mjs

echo "ALL CHECKS PASSED"
