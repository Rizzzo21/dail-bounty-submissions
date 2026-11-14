#!/usr/bin/env bash
# Verify this repository end to end, exactly as a judge would.
#
#   bash docs/verify.sh
#
# Exits 0 only if every check passes. No network access is required.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

FAILED=0
CHECKS=0
step() {
  echo ""
  echo "=============================================================="
  echo "== $1"
  echo "=============================================================="
}
ok()   { CHECKS=$((CHECKS+1)); echo "   [PASS] $1"; }
bad()  { CHECKS=$((CHECKS+1)); echo "   [FAIL] $1"; FAILED=1; }

step "0. environment"
if ! command -v node >/dev/null 2>&1; then
  echo "   node is not installed -- cannot continue"
  exit 1
fi
echo "   node $(node --version)"
echo "   npm  $(npm --version 2>/dev/null || echo 'not installed (not needed)')"

step "1. required files are present"
for f in README.md LICENSE package.json src/simulation.js scripts/demo.mjs docs/verify.sh; do
  if [ -f "$f" ]; then ok "$f exists"; else bad "$f is missing"; fi
done

step "2. there are no dependencies to install"
if [ -f package.json ]; then
  DEPS=$(node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies||{}).length + Object.keys(p.devDependencies||{}).length)")
  if [ "$DEPS" = "0" ]; then ok "package.json declares 0 dependencies"; else bad "package.json declares $DEPS dependencies"; fi
fi
if [ -d node_modules ]; then
  echo "   [INFO] a node_modules directory exists (not required, not used by the demo)"
fi

step "3. unit + integration tests (node --test, offline)"
if node --test 2>&1 | tee /tmp/near-swarm-tests.log | tail -12; then
  ok "node --test exited 0"
else
  bad "node --test failed (see /tmp/near-swarm-tests.log)"
fi
if grep -qE "^(\#\s+fail|ℹ fail) 0$" /tmp/near-swarm-tests.log; then
  ok "0 failing tests"
else
  bad "there are failing tests"
fi

step "4. the demo runs and prints a transcript"
if node scripts/demo.mjs > /tmp/near-swarm-demo.txt 2>/tmp/near-swarm-demo.err; then
  ok "node scripts/demo.mjs exited 0"
else
  bad "node scripts/demo.mjs failed (see /tmp/near-swarm-demo.err)"
fi
if [ -s /tmp/near-swarm-demo.txt ]; then
  ok "transcript is $(wc -l < /tmp/near-swarm-demo.txt) lines"
else
  bad "transcript is empty"
fi

step "5. the transcript contains the expected milestones"
check_line() {
  if grep -qF "$1" /tmp/near-swarm-demo.txt; then ok "found: $1"; else bad "missing: $1"; fi
}
check_line "JOB POSTED"
check_line "BID REJECTED"
check_line "VOTE WITHHELD"
check_line "NO CONSENSUS"
check_line "AWARDED"
check_line "COLLECTIVE BUY"
check_line "AGGREGATE"
check_line "ESCROW (public) amount=null"
check_line "FINAL STATE"

step "6. the demo is deterministic (two runs are byte-identical)"
node scripts/demo.mjs > /tmp/near-swarm-demo2.txt 2>/dev/null
if cmp -s /tmp/near-swarm-demo.txt /tmp/near-swarm-demo2.txt; then
  ok "two runs produced identical output"
else
  bad "two runs differed"
fi

step "7. the JSON trace is valid and complete"
if node scripts/demo.mjs --json > /tmp/near-swarm-trace.json 2>/dev/null; then
  ok "node scripts/demo.mjs --json exited 0"
else
  bad "the JSON trace could not be produced"
fi
if node -e "
  const t = require('/tmp/near-swarm-trace.json');
  const need = ['job_posted','bid_placed','job_awarded','job_settled','purchase_settled','private_aggregate_published','simulation_finished'];
  const types = new Set(t.trace.map(e => e.type));
  const missing = need.filter(n => !types.has(n));
  if (missing.length) { console.error('   missing event types: ' + missing.join(', ')); process.exit(1); }
  console.log('   trace has ' + t.trace.length + ' events across ' + t.rounds + ' rounds');
" 2>/dev/null; then
  ok "JSON trace contains every required event type"
else
  bad "JSON trace is missing event types"
fi

step "8. demo material can be regenerated"
if node scripts/screenshot.mjs >/dev/null 2>&1; then
  ok "screenshot.svg regenerated"
  if [ -s docs/demo-screenshot.svg ]; then
    ok "docs/demo-screenshot.svg is $(wc -c < docs/demo-screenshot.svg) bytes"
  else
    bad "docs/demo-screenshot.svg is empty"
  fi
else
  bad "the screenshot generator failed"
fi
if bash scripts/record.sh >/dev/null 2>&1; then
  ok "docs/recording.txt regenerated"
else
  bad "the recording script failed"
fi

step "9. no secrets are committed"
if git rev-parse --git-dir >/dev/null 2>&1; then
  if git grep -nEI '(private[_-]?key|secret[_-]?key|api[_-]?key)[[:space:]]*[:=][[:space:]]*["'\''][A-Za-z0-9/+_-]{16,}' -- . >/dev/null 2>&1; then
    bad "a hard-coded secret-looking string was found in tracked files"
  else
    ok "no secret-looking strings in tracked files"
  fi
  if [ -f .env ] || [ -f .env.local ]; then
    bad "an .env file is committed"
  else
    ok "no .env file committed"
  fi
else
  echo "   [INFO] not a git repository -- skipping the git-based secret scan"
fi

step "RESULT"
if [ "$FAILED" = "0" ]; then
  echo "   ALL CHECKS PASSED ($CHECKS checks)"
  exit 0
fi
echo "   SOME CHECKS FAILED ($CHECKS checks)"
exit 1
