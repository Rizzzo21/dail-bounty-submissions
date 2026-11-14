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

say "== RITUAL - verification =="

# 1. runtime
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then ok "node >= 18 (found $(node -v))"; else bad "node >= 18 required"; fi

# 2. no third-party dependencies
DEPS=$(node -p "Object.keys(require('./package.json').dependencies||{}).length + Object.keys(require('./package.json').devDependencies||{}).length" 2>/dev/null || echo 99)
if [ "$DEPS" = "0" ]; then ok "no third-party dependencies"; else bad "unexpected dependencies: $DEPS"; fi
check "no node_modules directory is needed" "[ ! -d node_modules ] || [ -z \"\$(ls -A node_modules 2>/dev/null)\" ]"

# 3. the test suite
if npm test >/tmp/ritual-test.log 2>&1; then
  PASSED=$(grep -E 'pass [0-9]+' /tmp/ritual-test.log 2>/dev/null | tail -1 | tr -dc '0-9')
  FAILED=$(grep -E 'fail [0-9]+' /tmp/ritual-test.log 2>/dev/null | tail -1 | tr -dc '0-9')
  ok "npm test (${PASSED:-?} passed, ${FAILED:-?} failed)"
else
  bad "npm test failed (see /tmp/ritual-test.log)"
  tail -20 /tmp/ritual-test.log | sed 's/^/        /'
fi

# 4. the demo runs
if node scripts/demo.mjs >/tmp/ritual-demo.txt 2>/tmp/ritual-demo.err; then
  ok "node scripts/demo.mjs runs"
else
  bad "node scripts/demo.mjs failed"; cat /tmp/ritual-demo.err | sed 's/^/        /'
fi

# 5. the demo is deterministic
node scripts/demo.mjs >/tmp/ritual-demo2.txt 2>/dev/null
if cmp -s /tmp/ritual-demo.txt /tmp/ritual-demo2.txt; then ok "the demo is byte-for-byte deterministic"; else bad "two demo runs differ"; fi

# 6. the published transcript matches a fresh run
if [ -f docs/demo-transcript.txt ]; then
  if cmp -s docs/demo-transcript.txt /tmp/ritual-demo.txt; then
    ok "docs/demo-transcript.txt matches a fresh run"
  else
    bad "docs/demo-transcript.txt differs from a fresh run"
  fi
else
  bad "docs/demo-transcript.txt is missing"
fi

# 7. the JSON trace is valid and its hash chain verifies
if node scripts/demo.mjs --json >/tmp/ritual-trace.json 2>/dev/null && node -e "
const t = JSON.parse(require('fs').readFileSync('/tmp/ritual-trace.json','utf8'));
const { createHash } = require('node:crypto');
const canon = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
  : '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canon(v[k])).join(',') + '}';
for (const sc of t.scenarios) {
  let prev = '0'.repeat(64);
  for (const e of sc.events) {
    if (e.prevHash !== prev) throw new Error('chain broken at ' + e.seq);
    const h = createHash('sha256').update(canon({seq:e.seq,type:e.type,payload:e.payload,prevHash:e.prevHash})).digest('hex');
    if (h !== e.hash) throw new Error('bad event hash at ' + e.seq);
    prev = e.hash;
  }
}
if (!t.scenarios.length) throw new Error('no scenarios');
" >/dev/null 2>&1; then
  ok "the JSON trace parses and every event hash chain verifies"
else
  bad "the JSON trace failed verification"
fi

# 8. no network access in the code that runs
# an XML namespace declaration is not a network call, so it is filtered out
if grep -rnE "\b(fetch|XMLHttpRequest|require\('https?'\)|from 'https?'|https?://)" src scripts test 2>/dev/null \
     | grep -v "xmlns" | grep -v "w3.org" | grep -q .; then
  bad "network calls found in src/ scripts/ test/"
  grep -rnE "\b(fetch|XMLHttpRequest|https?://)" src scripts test | grep -v xmlns | sed 's/^/        /'
else
  ok "no network calls in src/ scripts/ test/ (the demo and the tests run offline)"
fi

# 9. the deliverables exist
for f in README.md LICENSE package.json src/state.js src/engine.js src/mechanics.js src/ritual.js scripts/demo.mjs test/engine.test.mjs docs/demo-transcript.txt docs/demo-trace.json; do
  if [ -f "$f" ]; then ok "$f exists"; else bad "$f is missing"; fi
done

# 10. no secrets
if grep -rniE "(api[_-]?key|secret|password|private[_-]?key|BEGIN [A-Z ]*PRIVATE KEY)\s*[:=]\s*['\"][^'\"]{12,}" src scripts test docs README.md 2>/dev/null | grep -q .; then
  bad "something that looks like a secret is committed"
else
  ok "no secrets or keys in the tree"
fi

# 11. the README resolves every link AND quotes no figure the transcript lacks
# A stale number in the docs is a defect even when the code is right.
node -e "
const fs = require('fs');
const md = fs.readFileSync('README.md','utf8');
const links = [...md.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]).filter(l => !/^https?:/.test(l));
const missing = links.filter(l => !fs.existsSync(l));
if (missing.length) { console.error('missing: ' + missing.join(', ')); process.exit(1); }
const transcript = fs.readFileSync('docs/demo-transcript.txt','utf8');
const blocks = [...md.matchAll(/\`\`\`[a-z]*\n([\s\S]*?)\`\`\`/g)].map(m => m[1]);
const NUM = /(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.,])\d+\.\d+(?![\d])/g;
const inTranscript = new Set((transcript.match(NUM) ?? []).map(n => n.replace(/,/g,'')));
const same = (a,b) => Math.abs(Number(a)-Number(b)) < 1e-9;
const stale = [];
for (const block of blocks) {
  if (!/^\s{2,}\S/m.test(block)) continue;
  for (const raw of block.match(NUM) ?? []) {
    const n = raw.replace(/,/g,'');
    if (![...inTranscript].some(t => same(t,n))) stale.push(raw);
  }
}
if (stale.length) { console.error('not in the transcript: ' + stale.join(', ')); process.exit(1); }
" >/dev/null 2>&1 && ok "the README resolves every link and quotes only figures from the real transcript" || bad "the README links to missing files or quotes a figure the transcript does not contain"

# 12. the deployment scope is stated EXACTLY: what is on chain, and what is not
# (an earlier version of this check was happy when the README said "not a
# deployed contract" - which stopped being true the moment the ritual was
# deployed. A scope check that only accepts one wording goes stale silently.)
if grep -q "orbit-ritual.testnet" README.md \
   && grep -qi "what is not here" README.md \
   && grep -qi "what is on chain" README.md \
   && grep -q "dover-break-advisor-programs.trycloudflare.com/near-ritual.git" README.md; then
  ok "the README states the deployment scope and names the public repository"
else
  bad "the README does not state the deployment scope or the public repository"
fi

# 🔴 THE COUNT THE README QUOTES MUST BE THE COUNT THIS SCRIPT RAN. A stale
# number in the README is a defect even when every check passes, and the fix
# has to live in the CODE - not only in the prose. This guard adds no check of
# its own, so the number it protects does not change when it is added.
README_COUNT="$(grep -oE 'ALL CHECKS PASSED \([0-9]+ checks?\)' README.md | head -1 | grep -oE '[0-9]+' || true)"
if [ -z "$README_COUNT" ]; then
  say "  FAIL  the README does not quote the check count"
  FAILED=$((FAILED+1))
elif [ "$README_COUNT" != "$CHECKS" ]; then
  say "  FAIL  the README quotes ($README_COUNT checks) but this script ran $CHECKS checks"
  FAILED=$((FAILED+1))
fi

# The summary always prints, even in quiet mode.
if [ "$FAILED" = "0" ]; then
  echo "ALL CHECKS PASSED ($CHECKS checks)"
  exit 0
fi
echo "$FAILED of $CHECKS CHECKS FAILED"
exit 1
