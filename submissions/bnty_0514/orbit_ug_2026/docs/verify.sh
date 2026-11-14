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

say "== PASSPORT - verification =="

# 1. runtime
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then ok "node >= 18 (found $(node -v))"; else bad "node >= 18 required"; fi

# 2. no third-party dependencies
DEPS=$(node -p "Object.keys(require('./package.json').dependencies||{}).length + Object.keys(require('./package.json').devDependencies||{}).length" 2>/dev/null || echo 99)
if [ "$DEPS" = "0" ]; then ok "no third-party dependencies"; else bad "unexpected dependencies: $DEPS"; fi

# 3. the test suite
if npm test >/tmp/passport-test.log 2>&1; then
  ok "npm test ($(grep -c '^ok ' /tmp/passport-test.log 2>/dev/null || true) tests passed)"
else
  bad "npm test failed (see /tmp/passport-test.log)"
  tail -20 /tmp/passport-test.log | sed 's/^/        /'
fi

# 3b. snapshot the PUBLISHED transcript before anything runs.
#     scripts/demo.mjs writes docs/demo-transcript.txt as a side effect, so a
#     later "published transcript matches a fresh run" check that reads the file
#     back would be comparing the demo against itself — always true, never a
#     control. Snapshot first, compare the snapshot.
cp docs/demo-transcript.txt /tmp/passport-transcript-pristine.txt 2>/dev/null || true

# 4. the demo runs
if node scripts/demo.mjs >/tmp/passport-demo.txt 2>/tmp/passport-demo.err; then
  ok "node scripts/demo.mjs runs"
else
  bad "node scripts/demo.mjs failed"; cat /tmp/passport-demo.err | sed 's/^/        /'
fi

# 5. the demo is deterministic
node scripts/demo.mjs >/tmp/passport-demo2.txt 2>/dev/null
if cmp -s /tmp/passport-demo.txt /tmp/passport-demo2.txt; then ok "the demo is byte-for-byte deterministic"; else bad "two demo runs differ"; fi

# 6. the PUBLISHED transcript (snapotted before the demo ran) matches a fresh run
if [ -f /tmp/passport-transcript-pristine.txt ]; then
  if cmp -s /tmp/passport-transcript-pristine.txt /tmp/passport-demo.txt; then
    ok "the published transcript matches a fresh run"
  else
    bad "the published transcript differs from a fresh run"
  fi
else
  bad "the published transcript is missing"
fi

# 7. the JSON trace is valid, the event chain verifies, and the card verifies
if node scripts/demo.mjs --json >/tmp/passport-trace.json 2>/dev/null && node -e "
const t = JSON.parse(require('fs').readFileSync('/tmp/passport-trace.json','utf8'));
const { createHash } = require('node:crypto');
const canon = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
  : '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canon(v[k])).join(',') + '}';
const h = (v) => createHash('sha256').update(canon(v)).digest('hex');
let prev = '0'.repeat(64);
for (const e of t.events) {
  if (e.prevHash !== prev) throw new Error('the event chain is broken at ' + e.seq);
  if (h({seq:e.seq,type:e.type,payload:e.payload,prevHash:e.prevHash}) !== e.hash) throw new Error('bad event hash at ' + e.seq);
  prev = e.hash;
}
if (!t.attestationCount) throw new Error('no attestations');
if (t.cardVerification.ok !== true) throw new Error('the passport card does not verify');
if (t.card.gates.pass !== false) throw new Error('the demo agent should not pass every gate');
" >/dev/null 2>&1; then
  ok "the JSON trace parses, the event chain verifies and the passport card verifies"
else
  bad "the JSON trace failed verification"
fi

# 8. every claim is traceable to a shipped source record
if node -e "
import('./src/attestations.js').then(async (m) => {
  const fs = await import('node:fs');
  const claims = m.loadClaims('attestations');
  const sources = [...m.loadSourceRecords('attestations','anchor-events.jsonl'),
                    ...m.loadSourceRecords('attestations','ritual-scenarios.json')];
  if (!claims.length) throw new Error('no claims');
  for (const claim of claims) {
    const check = m.verifyProvenance(claim, sources);
    if (!check.ok) throw new Error(claim.source.file + ': ' + check.reason);
  }
});" >/dev/null 2>&1; then
  ok "every claim is traceable to a record in a shipped source file"
else
  bad "a claim cannot be traced to its source record"
fi

# 9. the claims file is reproducible from the shipped sources
cp attestations/claims.json /tmp/passport-claims.json
if node scripts/build-claims.mjs >/dev/null 2>&1 && cmp -s attestations/claims.json /tmp/passport-claims.json; then
  ok "attestations/claims.json is reproducible (node scripts/build-claims.mjs)"
else
  bad "attestations/claims.json does not match a fresh build"
  cp /tmp/passport-claims.json attestations/claims.json
fi

# 10. the composite score is never a gate
if node -e "
import('./src/state.js').then(async (s) => {
  const e = await import('./src/engine.js');
  const sc = await import('./src/score.js');
  const state = s.createState();
  // an agent that is perfect in three categories and absent in one
  const subject = state.agentOrder[1];
  const attestation = e.makeAttestation({
    subject, issuer: 'test', category: 'settlement', claim: 'x', value: 1, issuedAt: 1800000000, source: null,
  });
  e.importAttestation(state, attestation);
  const scores = sc.categoryScores([attestation], state.policy, 1800000000);
  const gates = sc.evaluateGates(scores, state.policy);
  const composite = sc.compositeScore(scores, state.policy);
  if (gates.pass) throw new Error('the gates passed with three empty categories');
  if (composite >= 70) throw new Error('the composite should be dragged down, got ' + composite);
  if (gates.gates.some(g => JSON.stringify(g).includes('composite'))) throw new Error('a gate mentions the composite');
});" >/dev/null 2>&1; then
  ok "a gate is a conjunction over categories and never reads the composite score"
else
  bad "the composite score may be acting as a gate"
fi

# 11. no network access in the code that runs
# Look for network APIs, not URL strings: the claims file legitimately carries
# https:// URLs as DATA (where a published record lives).
if grep -rnE "(\bfetch[[:space:]]*\(|XMLHttpRequest|node:https?|require\(['\"]https?['\"]\)|from ['\"]https?['\"]|\bhttps?\.(request|get)\(|axios|undici)" src scripts test 2>/dev/null | grep -q .; then
  bad "network calls found in src/ scripts/ test/"
  grep -rnE "(\bfetch[[:space:]]*\(|XMLHttpRequest|node:https?|require\(['\"]https?['\"]\)|from ['\"]https?['\"]|\bhttps?\.(request|get)\(|axios|undici)" src scripts test | sed 's/^/        /'
else
  ok "no network calls in src/ scripts/ test/ (the demo and the tests run offline)"
fi

# 12. the deliverables exist
for f in README.md LICENSE package.json src/state.js src/engine.js src/score.js src/escrow.js \
         src/attestation.js src/attestations.js scripts/demo.mjs scripts/build-claims.mjs \
         test/passport.test.mjs attestations/claims.json attestations/anchor-events.jsonl \
         attestations/ritual-scenarios.json docs/demo-transcript.txt docs/demo-trace.json \
         docs/demo-screenshot.png; do
  if [ -f "$f" ]; then ok "$f exists"; else bad "$f is missing"; fi
done

# 13. no secrets
if grep -rniE "(api[_-]?key|secret|password|private[_-]?key|BEGIN [A-Z ]*PRIVATE KEY)\s*[:=]\s*['\"][^'\"]{12,}" src scripts test docs README.md attestations 2>/dev/null | grep -q .; then
  bad "something that looks like a secret is committed"
else
  ok "no secrets or keys in the tree"
fi

# 14. every file the README links to exists
node -e "
const fs = require('fs');
const md = fs.readFileSync('README.md','utf8');
const links = [...md.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]).filter(l => !/^https?:/.test(l));
const missing = links.filter(l => !fs.existsSync(l));
if (missing.length) { console.error('missing: ' + missing.join(', ')); process.exit(1); }
" >/dev/null 2>&1 && ok "every relative link in the README resolves" || bad "the README links to files that do not exist"

# 15. the harness reuse is declared where the README says it is
if grep -q "bnty_0421" README.md && grep -q "bnty_0414" README.md; then
  ok "the README declares the reused harness and the borrowed evidence"
else
  bad "the README does not declare the reused harness"
fi

# 16. the borrowed evidence is declared as data, not as code
if grep -q "byte-identical" README.md; then
  ok "the README states which files are byte-identical to the earlier entries"
else
  bad "the README does not state which files are byte-identical"
fi

# The summary always prints, even in quiet mode.
if [ "$FAILED" = "0" ]; then
  echo "ALL CHECKS PASSED ($CHECKS checks)"
  exit 0
fi
echo "$FAILED of $CHECKS CHECKS FAILED"
exit 1
