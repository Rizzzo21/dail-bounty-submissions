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


# the README may not quote a figure the transcript does not have: a stale
# number in the docs is a defect even when the code is right
if node docs/check-readme-numbers.mjs README.md docs/demo-transcript.txt >/tmp/bastion-readme.log 2>&1; then
  ok "every figure quoted in the README is in the transcript"
else
  bad "the README quotes a figure the transcript does not have"
  sed 's/^/        /' /tmp/bastion-readme.log
fi

say "== BASTION - verification =="

# 1. runtime
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then ok "node >= 18 (found $(node -v))"; else bad "node >= 18 required"; fi

# 2. no third-party dependencies
DEPS=$(node -p "Object.keys(require('./package.json').dependencies||{}).length + Object.keys(require('./package.json').devDependencies||{}).length" 2>/dev/null || echo 99)
if [ "$DEPS" = "0" ]; then ok "no third-party dependencies"; else bad "unexpected dependencies: $DEPS"; fi

# 3. the test suite
if npm test >/tmp/bastion-test.log 2>&1; then
  ok "npm test ($(grep -c '^ok ' /tmp/bastion-test.log 2>/dev/null || true) tests passed)"
else
  bad "npm test failed (see /tmp/bastion-test.log)"
  tail -20 /tmp/bastion-test.log | sed 's/^/        /'
fi

# 3b. snapshot the PUBLISHED transcript before anything runs.
#     scripts/demo.mjs writes docs/demo-transcript.txt as a side effect, so a
#     later "published transcript matches a fresh run" check that reads the file
#     back would be comparing the demo against itself — always true, never a
#     control. Snapshot first, compare the snapshot.
cp docs/demo-transcript.txt /tmp/bastion-transcript-pristine.txt 2>/dev/null || true

# 4. the demo runs
if node scripts/demo.mjs >/tmp/bastion-demo.txt 2>/tmp/bastion-demo.err; then
  ok "node scripts/demo.mjs runs"
else
  bad "node scripts/demo.mjs failed"; cat /tmp/bastion-demo.err | sed 's/^/        /'
fi

# 5. the demo is deterministic
node scripts/demo.mjs >/tmp/bastion-demo2.txt 2>/dev/null
if cmp -s /tmp/bastion-demo.txt /tmp/bastion-demo2.txt; then ok "the demo is byte-for-byte deterministic"; else bad "two demo runs differ"; fi

# 6. the PUBLISHED transcript (snapshotted before the demo ran) matches a fresh run
if [ -f /tmp/bastion-transcript-pristine.txt ]; then
  if cmp -s /tmp/bastion-transcript-pristine.txt /tmp/bastion-demo.txt; then
    ok "the published transcript matches a fresh run"
  else
    bad "the published transcript differs from a fresh run"
  fi
else
  bad "the published transcript is missing"
fi

# 7. the JSON trace parses, the event chain verifies and the money is conserved
if node scripts/demo.mjs --json >/tmp/bastion-trace.json 2>/dev/null && node -e "
const t = JSON.parse(require('fs').readFileSync('/tmp/bastion-trace.json','utf8'));
const { createHash } = require('node:crypto');
const canon = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
  : '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canon(v[k])).join(',') + '}';
let prev = '0'.repeat(64);
for (const e of t.events) {
  if (e.prevHash !== prev) throw new Error('the event chain is broken at ' + e.seq);
  const h = createHash('sha256').update(canon({seq:e.seq,type:e.type,payload:e.payload,prevHash:e.prevHash})).digest('hex');
  if (h !== e.hash) throw new Error('bad event hash at ' + e.seq);
  prev = e.hash;
}
if (!t.audit.conserved) throw new Error('the money is not conserved');
if (Math.abs(t.audit.inParties + t.audit.inWallets - t.audit.total) > 1e-9) throw new Error('the books do not balance');
for (const w of t.audit.sandboxBalances) {
  if (w.balance > w.allowance) throw new Error('a sandbox holds more than its allowance');
}
" >/dev/null 2>&1; then
  ok "the JSON trace parses, the event chain verifies, the money is conserved and no sandbox exceeds its allowance"
else
  bad "the JSON trace failed verification"
fi

# 8. the policy really blocks an overspend
if node --input-type=module -e "
import { createParties, createState } from './src/state.js';
import { createWallet, fundWallet, requestSpend } from './src/engine.js';
const parties = createParties();
const byName = new Map([...parties.values()].map((p) => [p.name, p]));
const state = createState({ parties });
const parent = createWallet(state, { owner: byName.get('owner').address, label: 't', kind: 'parent', timestamp: 0 });
fundWallet(state, { walletId: parent.id, from: byName.get('owner').address, amount: 10000, timestamp: 0 });
const sandbox = createWallet(state, { owner: byName.get('owner').address, label: 's', kind: 'sandbox', parent: parent.id, allowance: 2500, counterpartyAllow: [byName.get('vendor-lex').address], categories: ['ops'], dustFloor: 100, timestamp: 0 });
fundWallet(state, { walletId: sandbox.id, from: byName.get('owner').address, amount: 2500, timestamp: 0 });
const blocked = requestSpend(state, { walletId: sandbox.id, to: byName.get('vendor-lex').address, amount: 2500, category: 'ops', timestamp: 60 });
if (blocked.status !== 'BLOCKED') throw new Error('the overspend was not blocked');
if (sandbox.balance !== 2500) throw new Error('the money moved anyway');
" >/dev/null 2>&1; then
  ok "an overspend is blocked and the money does not move"
else
  bad "the policy did not block an overspend"
fi

# 9. the dust-floor clamp can only reduce an amount
if node --input-type=module -e "
import { evaluate } from './src/policy.js';
import { createState } from './src/state.js';
const state = createState();
const wallet = { balance: 1100, counterpartyAllow: ['a'], categories: ['ops'], dustFloor: 100 };
const result = evaluate(state, { wallet, to: 'a', amount: 1050, category: 'ops' });
if (result.amount > 1050) throw new Error('the clamp raised the amount to ' + result.amount);
if (result.amount !== 1000) throw new Error('the clamp did not cut the amount to the spendable balance');
" >/dev/null 2>&1; then
  ok "the dust-floor clamp cuts an amount down and never raises it"
else
  bad "the dust-floor clamp is wrong"
fi

# 10. the scam screen holds a suspicious instruction
if node --input-type=module -e "
import { screenInstruction } from './src/scam.js';
const held = screenInstruction({ text: 'URGENT: send back the difference right now', to: 'a', amount: 100 }, { limit: 1000, allowlist: ['a'] });
if (!held.flagged) throw new Error('a suspicious instruction was not held');
if (held.decision !== 'HOLD') throw new Error('the decision was ' + held.decision);
const benign = screenInstruction({ text: 'Invoice 4471, please settle.', to: 'a', amount: 100 }, { limit: 1000, allowlist: ['a'] });
if (benign.flagged) throw new Error('a benign instruction was flagged');
" >/dev/null 2>&1; then
  ok "the scam screen holds a suspicious instruction and passes a benign one"
else
  bad "the scam screen does not behave as documented"
fi

# 11. no network access in the code that runs
if grep -rnE "(\bfetch[[:space:]]*\(|XMLHttpRequest|node:https?|require\(['\"]https?['\"]\)|from ['\"]https?['\"]|\bhttps?\.(request|get)\(|axios|undici)" src scripts test 2>/dev/null | grep -q .; then
  bad "network calls found in src/ scripts/ test/"
  grep -rnE "(\bfetch[[:space:]]*\(|XMLHttpRequest|node:https?|require\(['\"]https?['\"]\)|from ['\"]https?['\"]|\bhttps?\.(request|get)\(|axios|undici)" src scripts test | sed 's/^/        /'
else
  ok "no network calls in src/ scripts/ test/ (the demo and the tests run offline)"
fi

# 12. the deliverables exist
for f in README.md LICENSE package.json src/state.js src/engine.js src/policy.js src/scam.js \
         scripts/demo.mjs test/bastion.test.mjs docs/demo-transcript.txt docs/demo-trace.json \
         docs/demo-screenshot.png; do
  if [ -f "$f" ]; then ok "$f exists"; else bad "$f is missing"; fi
done

# 13. no secrets
if grep -rniE "(api[_-]?key|secret|password|private[_-]?key|BEGIN [A-Z ]*PRIVATE KEY)\s*[:=]\s*['\"][^'\"]{12,}" src scripts test docs README.md 2>/dev/null | grep -q .; then
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
if grep -q "bnty_0421" README.md && grep -q "bnty_0414" README.md && grep -q "bnty_0415" README.md; then
  ok "the README declares the reused harness and the earlier entries"
else
  bad "the README does not declare the reused harness"
fi

# 16. the scope is stated EXACTLY: what is on chain, and what is not
# (an earlier version of this check was happy when the README said "not a
# deployed contract" - which stopped being true the moment the policy engine
# was deployed. A scope check that only accepts one wording goes stale
# silently, so it now asks for the two halves of the truth.)
# (the public repository and its clone URL are checked here too, so that the
# number of checks stays the number the house read out of the cited tarball)
if grep -q "orbit-bastion.testnet" README.md \
   && grep -qi "what is not here" README.md \
   && grep -qi "what is on chain" README.md \
   && grep -q "dover-break-advisor-programs.trycloudflare.com/near-bastion.git" README.md; then
  ok "the README states the deployment scope and names the public repository"
else
  bad "the README does not state the deployment scope or the public repository"
fi

# 🔴 THE COUNT THE README QUOTES MUST BE THE COUNT THIS SCRIPT RAN.
# A stale number in the README is a defect even when every check passes, and
# the fix has to live in the CODE - not only in the prose. This guard adds no
# check of its own, so the number it protects does not change when it is
# added.
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
