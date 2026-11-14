// contract/assembly/index.ts - the MINIMAL NEAR policy-extension contract for the TREZU-SOCIAL
// entry (bnty_0569 fix item 2: "Deploy a minimal policy-extension contract to NEAR testnet
// and cite the contract account + tx hashes with explorer links").
//
// WHAT IT IS: the on-chain counterpart of src/engine.mjs. It implements exactly the same
// rules, over the same fixture, and returns the same values. The deployment script
// scripts/deploy-and-verify.mjs drives it on testnet and ASSERTS that the on-chain output
// equals the offline engine's output, so "the demo matches the chain" is a checked fact and
// not a claim.
//
// THE MECHANICAL MAPPING to the REAL Sputnik DAO v2 (see the README section "Where 'Trezu'
// comes from" - the mapping is to documented Sputnik DAO v2 features, not to an invented
// primitive):
//
//   shared epoch budget  <->  an `AddBounty` proposal: a bounty carries `token` + `amount`
//   reward payout        <->  `bounty_done(id)` -> a `BountyDone` proposal -> payout when voted
//   reputation gate      <->  a custom VOTING POLICY in the Sputnik DAO v2 policy engine
//   multisig vault       <->  the DAO's own treasury / the bounty pool
//
// STORAGE LAYOUT (one key per field - deliberately no JSON, so the contract has no parsing
// surface and no schema drift):
//   b:<budget>:label | :total | :remaining | :spent | :gate | :epoch
//   rep:<actor>            reputation points
//   reward:<actor>         released reward balance, USDC
//   vault                  multisig vault balance, USDC

import { storage, logging } from "near-sdk-as";

const BUDGET = "q4-growth";
const VAULT_INIT = 50000;

function getInt(key: string, dflt: i32): i32 {
  return storage.getPrimitive<i32>(key, dflt);
}

function getStr(key: string): string {
  const v = storage.getString(key);
  if (v === null) {
    return "";
  }
  return changetype<string>(v);
}

// ---------------------------------------------------------------------------
// INITIALISATION
// ---------------------------------------------------------------------------

export function initBudget(
  budgetId: string,
  label: string,
  totalUsdc: i32,
  minReputation: i32,
  epoch: string
): void {
  storage.setString("b:" + budgetId + ":label", label);
  storage.set<i32>("b:" + budgetId + ":total", totalUsdc);
  storage.set<i32>("b:" + budgetId + ":remaining", totalUsdc);
  storage.set<i32>("b:" + budgetId + ":spent", 0);
  storage.set<i32>("b:" + budgetId + ":gate", minReputation);
  storage.setString("b:" + budgetId + ":epoch", epoch);
  logging.log("initBudget " + budgetId);
}

export function setReputation(actor: string, reputation: i32): void {
  storage.set<i32>("rep:" + actor, reputation);
}

export function setRewardBalance(actor: string, balanceUsdc: i32): void {
  storage.set<i32>("reward:" + actor, balanceUsdc);
}

export function setVault(balanceUsdc: i32): void {
  storage.set<i32>("vault", balanceUsdc);
}

// init() seeds the same fixture the offline engine uses, in one transaction.
export function init(): void {
  initBudget(BUDGET, "Q4 Growth shared budget", 5000, 65, "Q4");
  setReputation("ops-alice.near", 82);
  setReputation("builder-bob.near", 60);
  setReputation("newcomer-eve.near", 41);
  setRewardBalance("builder-bob.near", 0);
  setVault(VAULT_INIT);
  logging.log("trezu policy extension initialised");
}

// ---------------------------------------------------------------------------
// RULE 1 - reputation-gated shared-budget spend
// ---------------------------------------------------------------------------
export function spendFromBudget(actor: string, budgetId: string, amountUsdc: i32): string {
  const label = getStr("b:" + budgetId + ":label");
  const epoch = getStr("b:" + budgetId + ":epoch");
  const gate = getInt("b:" + budgetId + ":gate", 0);
  const remaining = getInt("b:" + budgetId + ":remaining", 0);
  const spent = getInt("b:" + budgetId + ":spent", 0);
  const vault = getInt("vault", 0);
  const repRaw = storage.getString("rep:" + actor);

  if (repRaw == null) {
    return '{"status":"REFUSED","reason":"unknown_actor","budget_id":"' + budgetId +
      '","actor":"' + actor + '","amount_usdc":' + amountUsdc.toString() + '}';
  }
  const reputation = storage.getPrimitive<i32>("rep:" + actor, 0);

  if (reputation < gate) {
    return '{"status":"REFUSED","reason":"reputation_below_minimum","budget_id":"' + budgetId +
      '","budget_label":"' + label + '","epoch":"' + epoch + '","actor":"' + actor +
      '","amount_usdc":' + amountUsdc.toString() +
      ',"reputation":' + reputation.toString() +
      ',"min_reputation":' + gate.toString() +
      ',"remaining_budget_usdc":' + remaining.toString() +
      ',"vault_balance_usdc":' + vault.toString() + '}';
  }
  if (amountUsdc > remaining) {
    return '{"status":"REFUSED","reason":"budget_exhausted","budget_id":"' + budgetId +
      '","budget_label":"' + label + '","epoch":"' + epoch + '","actor":"' + actor +
      '","amount_usdc":' + amountUsdc.toString() +
      ',"reputation":' + reputation.toString() +
      ',"min_reputation":' + gate.toString() +
      ',"remaining_budget_usdc":' + remaining.toString() +
      ',"vault_balance_usdc":' + vault.toString() + '}';
  }

  // APPROVED - mutate the real state.
  const newRemaining = remaining - amountUsdc;
  const newSpent = spent + amountUsdc;
  const newVault = vault - amountUsdc;
  storage.set<i32>("b:" + budgetId + ":remaining", newRemaining);
  storage.set<i32>("b:" + budgetId + ":spent", newSpent);
  storage.set<i32>("vault", newVault);

  return '{"status":"APPROVED","budget_id":"' + budgetId +
    '","budget_label":"' + label + '","epoch":"' + epoch + '","actor":"' + actor +
    '","amount_usdc":' + amountUsdc.toString() +
    ',"reputation":' + reputation.toString() +
    ',"min_reputation":' + gate.toString() +
    ',"total_budget_usdc":' + getInt("b:" + budgetId + ":total", 0).toString() +
    ',"remaining_budget_usdc":' + newRemaining.toString() +
    ',"vault_balance_usdc":' + newVault.toString() + '}';
}

// ---------------------------------------------------------------------------
// RULE 2 - quorum-gated programmable reward payout
// ---------------------------------------------------------------------------
export function claimReward(
  actor: string,
  milestone: string,
  stewardApprovals: i32,
  requiredApprovals: i32,
  rewardUsdc: i32,
  reputationDelta: i32
): string {
  const before = getInt("rep:" + actor, 0);
  const balanceBefore = getInt("reward:" + actor, 0);

  if (stewardApprovals < requiredApprovals) {
    return '{"status":"REFUSED","reason":"insufficient_steward_approvals","actor":"' + actor +
      '","milestone":"' + milestone +
      '","steward_approvals":' + stewardApprovals.toString() +
      ',"required_approvals":' + requiredApprovals.toString() +
      ',"reward_usdc":' + rewardUsdc.toString() +
      ',"reputation_delta":' + reputationDelta.toString() +
      ',"new_reputation":' + before.toString() +
      ',"reward_balance_usdc":' + balanceBefore.toString() + '}';
  }

  const after = before + reputationDelta;
  const balanceAfter = balanceBefore + rewardUsdc;
  storage.set<i32>("rep:" + actor, after);
  storage.set<i32>("reward:" + actor, balanceAfter);

  return '{"status":"RELEASED","actor":"' + actor +
    '","milestone":"' + milestone +
    '","steward_approvals":' + stewardApprovals.toString() +
    ',"required_approvals":' + requiredApprovals.toString() +
    '","reward_usdc":' + rewardUsdc.toString() +
    ',"reputation_delta":' + reputationDelta.toString() +
    ',"previous_reputation":' + before.toString() +
    ',"new_reputation":' + after.toString() +
    '","reward_balance_usdc":' + balanceAfter.toString() + '}';
}

// ---------------------------------------------------------------------------
// VIEWS
// ---------------------------------------------------------------------------
export function getBudget(budgetId: string): string {
  return '{"budget_id":"' + budgetId +
    '","budget_label":"' + getStr("b:" + budgetId + ":label") +
    '","epoch":"' + getStr("b:" + budgetId + ":epoch") +
    '","total_usdc":' + getInt("b:" + budgetId + ":total", 0).toString() +
    '","remaining_usdc":' + getInt("b:" + budgetId + ":remaining", 0).toString() +
    '","spent_usdc":' + getInt("b:" + budgetId + ":spent", 0).toString() +
    '","min_reputation":' + getInt("b:" + budgetId + ":gate", 0).toString() +
    '","vault_balance_usdc":' + getInt("vault", 0).toString() + '}';
}

export function getReputation(actor: string): string {
  return '{"actor":"' + actor + '","reputation":' + getInt("rep:" + actor, 0).toString() + '}';
}

export function getRewardBalance(actor: string): string {
  return '{"actor":"' + actor + '","reward_balance_usdc":' + getInt("reward:" + actor, 0).toString() + '}';
}

export function getVault(): string {
  return '{"vault_balance_usdc":' + getInt("vault", 0).toString() + '}';
}
