#!/usr/bin/env bash
set -euo pipefail
# Run from anywhere: cd to the package directory that holds this script.
cd "$(dirname "$0")/.."
node --test test/engine.test.mjs
out1="$(node scripts/demo.mjs)"
out2="$(node scripts/demo.mjs)"
if [ "$out1" != "$out2" ]; then
  echo "Determinism check failed"
  exit 1
fi
echo "ALL CHECKS PASSED"
