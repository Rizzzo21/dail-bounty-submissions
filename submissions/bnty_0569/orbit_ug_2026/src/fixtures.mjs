// src/fixtures.mjs - THE SHARED FIXTURE: the single source of truth for every number.
//
// WHY THIS FILE EXISTS (bnty_0569 fix): the upstream entry asserted its numbers as literal
// strings in a step spec and replayed them; nothing was derived. A "polished" entry that
// still asserts numbers is the exact defect the house is hunting ("No asserted-but-
// unimplemented ... "). So the numbers now live in ONE place, and:
//
//   * the offline demo engine (src/engine.mjs) derives every metric and every summary from
//     this fixture, and
//   * the on-chain deployment script (scripts/deploy-and-verify.mjs) sends THESE SAME inputs
//     to the deployed NEAR contract, which implements the same rules, and then ASSERTS that
//     the on-chain output equals the offline output.
//
// If someone changes a number here, both sides change together and the comparison in
// scripts/deploy-and-verify.mjs must still hold - or the script fails loudly.

export const EPOCH = "Q4";
export const BUDGET_ID = "q4-growth";
export const VAULT_ID = "ops-multisig-vault";
export const VAULT_BALANCE_USDC = 50000;

// The shared epoch budget the policy extension is supposed to enforce.
export const INITIAL_BUDGETS = [
  {
    budget_id: BUDGET_ID,
    label: "Q4 Growth shared budget",
    total_usdc: 5000,
    min_reputation: 65,
    epoch: EPOCH,
  },
];

// Reputation registry (the "reputation gate" input).
export const INITIAL_REPUTATION = {
  "ops-alice.near": 82,
  "builder-bob.near": 60,
  "newcomer-eve.near": 41,
};

// Per-actor reward balance (the "programmable reward" output).
export const INITIAL_REWARD_BALANCE = {
  "builder-bob.near": 0,
};

// The three try-it steps. The actors/amounts are the ONLY inputs; every number the demo
// prints is derived from state by src/engine.mjs.
export const STEPS = [
  {
    step: "shared_budget_spend",
    args: {
      actor: "ops-alice.near",
      budget_id: BUDGET_ID,
      amount_usdc: 1200,
    },
  },
  {
    step: "reward_payout",
    args: {
      actor: "builder-bob.near",
      milestone: "M-104",
      steward_approvals: 3,
      required_approvals: 3,
      reward_usdc: 450,
      reputation_delta: 18,
    },
  },
  {
    step: "reputation_gate",
    args: {
      actor: "newcomer-eve.near",
      budget_id: BUDGET_ID,
      amount_usdc: 500,
    },
  },
];

export function freshBudgets() {
  return INITIAL_BUDGETS.map((b) => ({ ...b }));
}

export function freshReputation() {
  return { ...INITIAL_REPUTATION };
}

export function freshRewardBalance() {
  return { ...INITIAL_REWARD_BALANCE };
}
