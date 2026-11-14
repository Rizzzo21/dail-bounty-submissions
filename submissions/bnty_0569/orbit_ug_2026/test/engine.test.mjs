import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicStateMachine, PolicyEngine, renderSummary, sha256Hex } from '../src/engine.mjs';
import { STEPS, VAULT_BALANCE_USDC, BUDGET_ID } from '../src/fixtures.mjs';

test('deterministic state machine executes all 3 try-it steps identically across runs', () => {
  const m1 = new DeterministicStateMachine().runAllTryItSteps(STEPS);
  const m2 = new DeterministicStateMachine().runAllTryItSteps(STEPS);
  assert.equal(m1.eventCount, 3);
  assert.equal(m1.chainVerified, true);
  assert.equal(m1.headHash, m2.headHash);
  assert.deepEqual(m1.events, m2.events);
});

test('tampering with any event payload invalidates hash chain verification', () => {
  const m = new DeterministicStateMachine();
  m.runAllTryItSteps(STEPS);
  assert.equal(m.verifyChain(), true);
  m.events[1].metrics = { summary: 'tampered', metrics: {} };
  assert.equal(m.verifyChain(), false);
});

// 🔴 THE INVARIANT TEST MUST BE ABLE TO FAIL (bnty_0569: "the invariant test fails if the
// numbers are tampered with"). These two tests prove the detector detects a tampered number
// AND that an untampered run reports zero violations - a control that cannot fail would
// make the whole "numbers are computed" claim decorative.
test('invariant checker reports ZERO violations on an untampered run', () => {
  const snap = new DeterministicStateMachine().runAllTryItSteps(STEPS);
  assert.deepEqual(snap.invariantViolations, []);
});

test('invariant checker DETECTS a tampered budget number', () => {
  const m = new DeterministicStateMachine();
  m.runAllTryItSteps(STEPS);
  m.engine.budgets[0].remaining_usdc = 9999;
  const v = m.engine.checkInvariants();
  assert.ok(v.length > 0, 'tampering must be detected');
  assert.ok(v.some((x) => x.includes('budget ' + BUDGET_ID)), 'the budget violation must be named');
});

test('invariant checker DETECTS a tampered vault balance', () => {
  const m = new DeterministicStateMachine();
  m.runAllTryItSteps(STEPS);
  m.engine.vault.balance_usdc = VAULT_BALANCE_USDC + 1;
  const v = m.engine.checkInvariants();
  assert.ok(v.length > 0);
  assert.ok(v.some((x) => x.includes('vault')));
});

test('the try-it numbers are DERIVED from state, not asserted', () => {
  const m = new DeterministicStateMachine();
  const snap = m.runAllTryItSteps(STEPS);
  const b = snap.state.budgets[0];

  // remaining = total - spent, recomputed here from the ledger.
  const spent = snap.events[0].metrics.amount_usdc;
  assert.equal(b.remaining_usdc, b.total_usdc - spent);
  assert.equal(b.spent_usdc, spent);
  assert.equal(snap.state.vault_balance_usdc, VAULT_BALANCE_USDC - spent);

  // reward: new reputation = previous + delta, recomputed.
  const r = snap.events[1].metrics;
  assert.equal(r.new_reputation, r.previous_reputation + r.reputation_delta);

  // the refused spend changed nothing.
  assert.equal(snap.events[2].metrics.status, 'REFUSED');
  assert.equal(snap.events[2].metrics.remaining_budget_usdc, b.remaining_usdc);
});

test('the reputation gate refuses a spend below the gate and leaves state untouched', () => {
  const e = new PolicyEngine();
  const before = JSON.stringify(e.budgets) + JSON.stringify(e.vault);
  const r = e.spendFromBudget({ actor: 'newcomer-eve.near', budget_id: BUDGET_ID, amount_usdc: 500 });
  assert.equal(r.status, 'REFUSED');
  assert.equal(r.reason, 'reputation_below_minimum');
  assert.equal(r.reputation, 41);
  assert.equal(r.min_reputation, 65);
  assert.equal(before, JSON.stringify(e.budgets) + JSON.stringify(e.vault));
});

test('the budget ceiling refuses a spend larger than the remaining epoch budget', () => {
  const e = new PolicyEngine();
  const r = e.spendFromBudget({ actor: 'ops-alice.near', budget_id: BUDGET_ID, amount_usdc: 999999 });
  assert.equal(r.status, 'REFUSED');
  assert.equal(r.reason, 'budget_exhausted');
});

test('a reward payout without the steward quorum is refused', () => {
  const e = new PolicyEngine();
  const r = e.claimReward({
    actor: 'builder-bob.near',
    milestone: 'M-104',
    steward_approvals: 2,
    required_approvals: 3,
    reward_usdc: 450,
    reputation_delta: 18,
  });
  assert.equal(r.status, 'REFUSED');
  assert.equal(r.reason, 'insufficient_steward_approvals');
});

test('summaries are TEMPLATED from the computed result (no hard-coded prose)', () => {
  const m = new DeterministicStateMachine();
  const snap = m.runAllTryItSteps(STEPS);
  for (const ev of snap.events) {
    const rendered = renderSummary(ev.step, ev.metrics);
    assert.equal(ev.summary, rendered, 'summary must equal the template of its own metrics');
    // every number that appears in the summary must appear in the metrics.
    // String-valued metric fields (budget_label "Q4 Growth shared budget", epoch "Q4")
    // are label text, not figures, so they are removed before scanning for numbers.
    let scannable = ev.summary;
    for (const v of Object.values(ev.metrics)) {
      if (typeof v === 'string') scannable = scannable.split(v).join(' ');
    }
    for (const num of scannable.match(/[0-9][0-9,]*/g) || []) {
      const bare = num.replace(/,/g, '');
      const values = Object.values(ev.metrics).map((v) => String(v));
      assert.ok(
        values.some((v) => v === bare),
        `summary number ${num} must come from the metrics`
      );
    }
  }
});

test('rejects empty step names', () => {
  const m = new DeterministicStateMachine();
  assert.throws(() => m.applyStep('', {}), /stepName must be a non-empty string/);
});

test('each try-it step produces non-empty metrics and valid 64-hex SHA-256 digest', () => {
  const snap = new DeterministicStateMachine().runAllTryItSteps(STEPS);
  for (let i = 0; i < STEPS.length; i++) {
    assert.equal(snap.events[i].step, STEPS[i].step);
    assert.match(snap.events[i].hash, /^[0-9a-f]{64}$/);
    assert.ok(Object.keys(snap.events[i].metrics).length > 0);
  }
});

test('sha256Hex is the real SHA-256 of its input', () => {
  // a control: if this ever stopped being SHA-256, the chain would still "verify"
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
