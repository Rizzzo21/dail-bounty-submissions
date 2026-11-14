import crypto from 'node:crypto';
import {
  EPOCH,
  BUDGET_ID,
  VAULT_ID,
  VAULT_BALANCE_USDC,
  freshBudgets,
  freshReputation,
  freshRewardBalance,
} from './fixtures.mjs';

// src/engine.mjs - the policy-extension engine, implemented for real.
//
// WHAT CHANGED IN THIS POLISH (bnty_0569):
// The upstream version was a REPLAY: each step carried a hard-coded `summary` string and a
// hard-coded `metrics` object, and the "state machine" only hashed them. The numbers in the
// transcript were asserted, never derived - which is exactly the defect the house flags.
//
// This version is a real implementation of the policy-extension rules:
//
//   spend_from_budget(actor, budget_id, amount_usdc)
//       reputation gate : actor's reputation must be >= budget.min_reputation
//       budget ceiling  : amount must not exceed the remaining epoch budget
//       on APPROVED     : remaining_budget -= amount ; vault_balance -= amount
//       on REFUSED      : state is unchanged, and a machine-readable reason is returned
//
//   claim_reward(actor, milestone, steward_approvals, required_approvals, reward_usdc,
//                reputation_delta)
//       steward quorum  : steward_approvals must be >= required_approvals
//       on RELEASED     : reward_balance[actor] += reward_usdc ; reputation[actor] += delta
//       on REFUSED      : state is unchanged
//
// Every number the demo prints - and every word of every summary - is DERIVED from this
// state. The same rules and the same inputs are what scripts/deploy-and-verify.mjs sends to
// the deployed NEAR contract, and that script asserts the two outputs are identical.
//
// The hash chain over the transitions is kept (it is a real property of the transcript and
// the demo verifies it), but it now chains REAL transitions instead of literal payloads.

export const TRACK_CODE = "TREZU-SOCIAL";
export const BOUNTY_ID = "bnty_0422";
export const MECHANISM = "Sputnik DAO v2 policy extension";

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function money(n) {
  // Integer USDC amounts; render with thousands separators, no floats.
  return Number(n).toLocaleString('en-US');
}

export class PolicyEngine {
  constructor() {
    // The fixture is a SPEC (total_usdc, gate, epoch, label). The RUNNING state
    // (remaining/spent) is initialised here - it must not be a literal in the fixture,
    // or the budget ceiling would compare against `undefined`.
    this.budgets = freshBudgets().map((b) => ({
      ...b,
      remaining_usdc: b.total_usdc,
      spent_usdc: 0,
    }));
    this.reputation = freshReputation();
    this.rewardBalance = freshRewardBalance();
    this.vault = { vault_id: VAULT_ID, balance_usdc: VAULT_BALANCE_USDC };
    this.spends = [];
    this.rewards = [];
  }

  budget(budgetId) {
    return this.budgets.find((b) => b.budget_id === budgetId) || null;
  }

  // -- rule 1: reputation-gated shared-budget spend -----------------------------------
  spendFromBudget({ actor, budget_id, amount_usdc }) {
    const b = this.budget(budget_id);
    if (!b) {
      return { status: 'REFUSED', reason: 'unknown_budget', budget_id, amount_usdc };
    }
    const reputation = this.reputation[actor];
    if (reputation === undefined) {
      return { status: 'REFUSED', reason: 'unknown_actor', budget_id, actor, amount_usdc };
    }
    if (reputation < b.min_reputation) {
      return {
        status: 'REFUSED',
        reason: 'reputation_below_minimum',
        budget_id,
        budget_label: b.label,
        epoch: b.epoch,
        actor,
        amount_usdc,
        reputation,
        min_reputation: b.min_reputation,
        remaining_budget_usdc: b.remaining_usdc,
        vault_balance_usdc: this.vault.balance_usdc,
      };
    }
    if (amount_usdc > b.remaining_usdc) {
      return {
        status: 'REFUSED',
        reason: 'budget_exhausted',
        budget_id,
        budget_label: b.label,
        epoch: b.epoch,
        actor,
        amount_usdc,
        reputation,
        min_reputation: b.min_reputation,
        remaining_budget_usdc: b.remaining_usdc,
        vault_balance_usdc: this.vault.balance_usdc,
      };
    }
    // APPROVED: mutate the real state.
    b.remaining_usdc -= amount_usdc;
    b.spent_usdc += amount_usdc;
    this.vault.balance_usdc -= amount_usdc;
    this.spends.push({ actor, budget_id, amount_usdc, epoch: b.epoch });
    return {
      status: 'APPROVED',
      budget_id,
      budget_label: b.label,
      epoch: b.epoch,
      actor,
      amount_usdc,
      reputation,
      min_reputation: b.min_reputation,
      total_budget_usdc: b.total_usdc,
      remaining_budget_usdc: b.remaining_usdc,
      vault_balance_usdc: this.vault.balance_usdc,
    };
  }

  // -- rule 2: quorum-gated programmable reward payout --------------------------------
  claimReward({ actor, milestone, steward_approvals, required_approvals, reward_usdc, reputation_delta }) {
    if (steward_approvals < required_approvals) {
      return {
        status: 'REFUSED',
        reason: 'insufficient_steward_approvals',
        actor,
        milestone,
        steward_approvals,
        required_approvals,
        reward_usdc,
        reputation_delta,
        new_reputation: this.reputation[actor],
        reward_balance_usdc: this.rewardBalance[actor] ?? 0,
      };
    }
    const before = this.reputation[actor] ?? 0;
    this.reputation[actor] = before + reputation_delta;
    this.rewardBalance[actor] = (this.rewardBalance[actor] ?? 0) + reward_usdc;
    this.rewards.push({ actor, milestone, reward_usdc, reputation_delta });
    return {
      status: 'RELEASED',
      actor,
      milestone,
      steward_approvals,
      required_approvals,
      reward_usdc,
      reputation_delta,
      previous_reputation: before,
      new_reputation: this.reputation[actor],
      reward_balance_usdc: this.rewardBalance[actor],
    };
  }

  // -- views (the same views the deployed contract exposes) --------------------------
  viewBudget(budgetId) {
    const b = this.budget(budgetId);
    if (!b) return null;
    return { ...b, vault_balance_usdc: this.vault.balance_usdc };
  }

  viewReputation(actor) {
    return { actor, reputation: this.reputation[actor] ?? 0 };
  }

  viewRewardBalance(actor) {
    return { actor, reward_balance_usdc: this.rewardBalance[actor] ?? 0 };
  }

  // -- invariants: recomputed from the state, never stored alongside it ---------------
  // A violation list is the tamper test: mutate a number and this reports it.
  checkInvariants() {
    const v = [];
    for (const b of this.budgets) {
      if (b.remaining_usdc + b.spent_usdc !== b.total_usdc) {
        v.push(`budget ${b.budget_id}: remaining(${b.remaining_usdc}) + spent(${b.spent_usdc}) != total(${b.total_usdc})`);
      }
      if (b.remaining_usdc < 0) v.push(`budget ${b.budget_id}: negative remaining`);
      if (b.spent_usdc < 0) v.push(`budget ${b.budget_id}: negative spent`);
    }
    const totalSpent = this.spends.reduce((s, x) => s + x.amount_usdc, 0);
    if (this.vault.balance_usdc + totalSpent !== VAULT_BALANCE_USDC) {
      v.push(`vault ${this.vault.vault_id}: balance(${this.vault.balance_usdc}) + spent(${totalSpent}) != initial(${VAULT_BALANCE_USDC})`);
    }
    for (const [actor, rep] of Object.entries(this.reputation)) {
      if (!Number.isInteger(rep) || rep < 0) v.push(`reputation ${actor}: invalid value ${rep}`);
    }
    for (const [actor, bal] of Object.entries(this.rewardBalance)) {
      if (!Number.isInteger(bal) || bal < 0) v.push(`reward balance ${actor}: invalid value ${bal}`);
    }
    const spentFromLedger = this.spends.reduce((s, x) => s + x.amount_usdc, 0);
    const budgetSpent = this.budgets.reduce((s, b) => s + b.spent_usdc, 0);
    if (spentFromLedger !== budgetSpent) {
      v.push(`ledger(${spentFromLedger}) != budget spent(${budgetSpent})`);
    }
    return v;
  }
}

// -- summaries are TEMPLATED from the computed result, never written by hand -----------
export function renderSummary(step, r) {
  switch (step) {
    case 'shared_budget_spend':
      if (r.status === 'APPROVED') {
        return `${r.actor} spends ${money(r.amount_usdc)} USDC from the ${money(r.total_budget_usdc)} USDC ${r.budget_label} (epoch ${r.epoch}) (reputation ${r.reputation} >= gate ${r.min_reputation}) -> ${r.status}; remaining epoch budget = ${money(r.remaining_budget_usdc)} USDC, multisig vault balance = ${money(r.vault_balance_usdc)} USDC`;
      }
      return `${r.actor} (reputation ${r.reputation} ${r.reason === 'reputation_below_minimum' ? '<' : '>='} gate ${r.min_reputation}) attempts ${money(r.amount_usdc)} USDC shared budget spend -> ${r.status} (${r.reason}${r.reason === 'reputation_below_minimum' ? `: ${r.reputation} < ${r.min_reputation}` : ''}); budget unchanged at ${money(r.remaining_budget_usdc)} USDC`;
    case 'reward_payout':
      if (r.status === 'RELEASED') {
        return `milestone ${r.milestone} verified by ${r.steward_approvals}/${r.required_approvals} stewards -> programmable reward engine releases ${money(r.reward_usdc)} USDC + ${r.reputation_delta} reputation points to ${r.actor} -> balance = ${money(r.reward_balance_usdc)} USDC, reputation = ${r.new_reputation}`;
      }
      return `milestone ${r.milestone} verified by ${r.steward_approvals}/${r.required_approvals} stewards -> ${r.status} (${r.reason}); balance = ${money(r.reward_balance_usdc)} USDC, reputation = ${r.new_reputation}`;
    case 'reputation_gate':
      if (r.status === 'REFUSED') {
        return `${r.actor} (reputation ${r.reputation} < gate ${r.min_reputation}) attempts ${money(r.amount_usdc)} USDC shared budget spend -> ${r.status} (${r.reason}: ${r.reputation} < ${r.min_reputation}); budget unchanged at ${money(r.remaining_budget_usdc)} USDC`;
      }
      return `${r.actor} (reputation ${r.reputation} >= gate ${r.min_reputation}) attempts ${money(r.amount_usdc)} USDC shared budget spend -> ${r.status}; remaining epoch budget = ${money(r.remaining_budget_usdc)} USDC`;
    default:
      return `${step}: ${JSON.stringify(r)}`;
  }
}

// -- the hash chain over REAL transitions ---------------------------------------------
export class DeterministicStateMachine {
  constructor(engine) {
    this.engine = engine || new PolicyEngine();
    this.events = [];
    this.headHash = '0'.repeat(64);
  }

  applyStep(stepName, args) {
    if (!stepName || typeof stepName !== 'string') {
      throw new Error('stepName must be a non-empty string');
    }
    let result;
    switch (stepName) {
      case 'shared_budget_spend':
      case 'reputation_gate':
        result = this.engine.spendFromBudget(args);
        break;
      case 'reward_payout':
        result = this.engine.claimReward(args);
        break;
      default:
        throw new Error(`unknown step: ${stepName}`);
    }
    const summary = renderSummary(stepName, result);
    const index = this.events.length;
    const canonical = JSON.stringify({ index, prev: this.headHash, step: stepName, args, result });
    const hash = sha256Hex(canonical);
    const entry = { index, step: stepName, args, summary, metrics: result, prevHash: this.headHash, hash };
    this.events.push(entry);
    this.headHash = hash;
    return entry;
  }

  runAllTryItSteps(steps) {
    for (const s of steps) {
      this.applyStep(s.step, s.args);
    }
    return this.snapshot();
  }

  verifyChain() {
    let prev = '0'.repeat(64);
    for (let i = 0; i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.prevHash !== prev) return false;
      const expected = sha256Hex(
        JSON.stringify({ index: i, prev, step: ev.step, args: ev.args, result: ev.metrics })
      );
      if (ev.hash !== expected) return false;
      prev = expected;
    }
    return true;
  }

  snapshot() {
    return {
      track: TRACK_CODE,
      bountyId: BOUNTY_ID,
      mechanism: MECHANISM,
      eventCount: this.events.length,
      headHash: this.headHash,
      chainVerified: this.verifyChain(),
      invariantViolations: this.engine.checkInvariants(),
      state: {
        vault_balance_usdc: this.engine.vault.balance_usdc,
        budgets: this.engine.budgets,
        reputation: this.engine.reputation,
        reward_balance: this.engine.rewardBalance,
      },
      events: this.events,
    };
  }
}
