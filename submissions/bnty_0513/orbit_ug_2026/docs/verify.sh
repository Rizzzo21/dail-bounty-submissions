#!/usr/bin/env bash
# The house re-runs this. It exits non-zero on the first failure, so it can be
# used as a gate: `bash docs/verify.sh`.
#
#   bash docs/verify.sh          verify the published tree
#   bash docs/verify.sh --quiet  only print the summary
set -u
cd "$(dirname "$0")/.."

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1
FAILED=0
CHECKS=0

say()  { [ "$QUIET" = "1" ] || echo "$@"; }
ok()   { CHECKS=$((CHECKS+1)); say "  PASS  $1"; }
bad()  { CHECKS=$((CHECKS+1)); FAILED=$((FAILED+1)); say "  FAIL  $1"; }
check(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }


# the README may not quote a figure the transcript does not have: a stale
# number in the docs is a defect even when the code is right
if node docs/check-readme-numbers.mjs README.md docs/demo-transcript.txt >/tmp/anchor-readme.log 2>&1; then
  ok "every figure quoted in the README is in the transcript"
else
  bad "the README quotes a figure the transcript does not have"
  sed 's/^/        /' /tmp/anchor-readme.log
fi

say "== ANCHOR - verification =="

# 1. runtime
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then ok "node >= 18 (found $(node -v))"; else bad "node >= 18 required"; fi

# 2. no third-party dependencies
DEPS=$(node -p "Object.keys(require('./package.json').dependencies||{}).length + Object.keys(require('./package.json').devDependencies||{}).length" 2>/dev/null || echo 99)
if [ "$DEPS" = "0" ]; then ok "no third-party dependencies"; else bad "unexpected dependencies: $DEPS"; fi

# 3. the test suite
if npm test >/tmp/anchor-test.log 2>&1; then
  PASSED=$(grep -E 'pass [0-9]+' /tmp/anchor-test.log 2>/dev/null | tail -1 | tr -dc '0-9')
  FAILED=$(grep -E 'fail [0-9]+' /tmp/anchor-test.log 2>/dev/null | tail -1 | tr -dc '0-9')
  ok "npm test (${PASSED:-?} passed, ${FAILED:-?} failed)"
else
  bad "npm test failed (see /tmp/anchor-test.log)"
  tail -20 /tmp/anchor-test.log | sed 's/^/        /'
fi

# 4. the demo runs
if node scripts/demo.mjs >/tmp/anchor-demo.txt 2>/tmp/anchor-demo.err; then
  ok "node scripts/demo.mjs runs"
else
  bad "node scripts/demo.mjs failed"; cat /tmp/anchor-demo.err | sed 's/^/        /'
fi

# 5. the demo is deterministic
node scripts/demo.mjs >/tmp/anchor-demo2.txt 2>/dev/null
if cmp -s /tmp/anchor-demo.txt /tmp/anchor-demo2.txt; then ok "the demo is byte-for-byte deterministic"; else bad "two demo runs differ"; fi

# 6. the published transcript matches a fresh run
if [ -f docs/demo-transcript.txt ]; then
  if cmp -s docs/demo-transcript.txt /tmp/anchor-demo.txt; then
    ok "docs/demo-transcript.txt matches a fresh run"
  else
    bad "docs/demo-transcript.txt differs from a fresh run"
  fi
else
  bad "docs/demo-transcript.txt is missing"
fi

# 7. the JSON trace is valid and its hash chain verifies
if node scripts/demo.mjs --json >/tmp/anchor-trace.json 2>/dev/null && node -e "
const t = JSON.parse(require('fs').readFileSync('/tmp/anchor-trace.json','utf8'));
const { createHash } = require('node:crypto');
const canon = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
  : '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canon(v[k])).join(',') + '}';
let prev = '0'.repeat(64);
for (const e of t.events) {
  if (e.prevHash !== prev) throw new Error('chain broken at ' + e.seq);
  const h = createHash('sha256').update(canon({seq:e.seq,type:e.type,payload:e.payload,prevHash:e.prevHash})).digest('hex');
  if (h !== e.hash) throw new Error('bad event hash at ' + e.seq);
  prev = e.hash;
}
if (!t.ledger.entries.length) throw new Error('empty ledger');
// the journal has to balance
let debit = 0, credit = 0;
for (const entry of t.ledger.entries) { debit += entry.debit; credit += entry.credit; }
if (Math.abs(debit - credit) > 1e-6) throw new Error('journal does not balance');
if (!t.coverage.covered) throw new Error('the reserve does not cover the claims');
" >/dev/null 2>&1; then
  ok "the JSON trace parses, the event hash chain verifies and the journal balances"
else
  bad "the JSON trace failed verification"
fi

# 8. no network access in the code that runs
if grep -rnE "\b(fetch|XMLHttpRequest|require\('https?'\)|from 'https?'|https?://)" src scripts test 2>/dev/null \
     | grep -v "xmlns" | grep -v "w3.org" | grep -q .; then
  bad "network calls found in src/ scripts/ test/"
  grep -rnE "\b(fetch|XMLHttpRequest|https?://)" src scripts test | grep -v xmlns | sed 's/^/        /'
else
  ok "no network calls in src/ scripts/ test/ (the demo and the tests run offline)"
fi

# 9. the deliverables exist
for f in README.md LICENSE package.json src/state.js src/engine.js src/asset.js src/ledger.js src/compliance.js scripts/demo.mjs test/registry.test.mjs docs/demo-transcript.txt docs/demo-trace.json docs/demo-screenshot.png; do
  if [ -f "$f" ]; then ok "$f exists"; else bad "$f is missing"; fi
done

# 10. no secrets
if grep -rniE "(api[_-]?key|secret|password|private[_-]?key|BEGIN [A-Z ]*PRIVATE KEY)\s*[:=]\s*['\"][^'\"]{12,}" src scripts test docs README.md 2>/dev/null | grep -q .; then
  bad "something that looks like a secret is committed"
else
  ok "no secrets or keys in the tree"
fi

# 11. every file the README links to exists
node -e "
const fs = require('fs');
const md = fs.readFileSync('README.md','utf8');
const links = [...md.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]).filter(l => !/^https?:/.test(l));
const missing = links.filter(l => !fs.existsSync(l));
if (missing.length) { console.error('missing: ' + missing.join(', ')); process.exit(1); }
" >/dev/null 2>&1 && ok "every relative link in the README resolves" || bad "the README links to files that do not exist"

# 12. the harness reuse is declared where the README says it is
if grep -q "bnty_0421" README.md; then ok "the README declares the reused harness (bnty_0421)"; else bad "the README does not declare the reused harness"; fi

# The README quotes this script's own check count ("ALL CHECKS PASSED (N checks)").
# If the two ever drift, the README is stale -- and a stale figure in the docs is a
# defect even when the code is right.  This guard adds no check of its own: it
# fails the script outright when the quoted number does not match the real count.
STATED=$(grep -oE 'ALL CHECKS PASSED \([0-9]+ checks\)' README.md | grep -oE '[0-9]+' | head -1)
if [ -n "$STATED" ] && [ "$STATED" != "$CHECKS" ]; then
  say "  FAIL  the README quotes ($STATED checks) but this script ran $CHECKS checks"
  FAILED=$((FAILED+1))
fi

# The summary always prints, even in quiet mode.
if [ "$FAILED" = "0" ]; then
  echo "ALL CHECKS PASSED ($CHECKS checks)"
  exit 0
fi
echo "$FAILED of $CHECKS CHECKS FAILED"
exit 1
