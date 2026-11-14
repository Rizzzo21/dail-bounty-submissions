// The policy engine.
//
// A request is measured against an ordered list of rules. Every rule leaves a
// trace, so a decision can be explained line by line: which rule was checked,
// what it saw, and what it decided. BLOCK is sticky - once a rule refuses, the
// later rules are recorded as skipped rather than consulted.
//
// The rules are ordered so that the CLAMP rules run first: an amount that is
// cut down to the dust floor is then measured against the spending limits.

export const DEFAULT_POLICY = {
  version: 'bastion-policy-1',
  rules: [
    {
      id: 'r-dust',
      kind: 'dustFloor',
      floor: 100,
      effect: 'clamp',
      reason: 'a sandbox may not leave its balance below the dust floor',
    },
    {
      id: 'r-allowlist',
      kind: 'counterpartyAllowlist',
      allow: [],
      effect: 'block',
      reason: 'the counterparty is not on the sandbox allowlist',
    },
    {
      id: 'r-category',
      kind: 'categoryAllowlist',
      allow: ['ops', 'infra'],
      effect: 'block',
      reason: 'the sandbox may only spend on ops and infra',
    },
    {
      id: 'r-limit-tx',
      kind: 'perTransaction',
      limit: 1000,
      effect: 'block',
      reason: 'a single transfer may not exceed 1,000',
    },
    {
      id: 'r-limit-day',
      kind: 'perWindow',
      windowSeconds: 86400,
      limit: 2000,
      effect: 'block',
      reason: 'the 24h allowance is 2,000',
    },
    {
      id: 'r-limit-counterparty',
      kind: 'perCounterparty',
      limit: 2000,
      effect: 'block',
      reason: 'one counterparty may not receive more than 2,000',
    },
  ],
};

export const ruleOf = (policy, kind) => policy.rules.find((rule) => rule.kind === kind);

// The engine. `context` carries what the wallet has already spent, so the
// window and per-counterparty limits are measured against real history.
export function evaluate(state, { wallet, to, amount, category, spentInWindow = 0, spentWithCounterparty = 0 }) {
  const trace = [];
  let decision = 'ALLOW';
  let effective = amount;
  let reason = 'within the policy';

  for (const rule of state.policy.rules) {
    if (decision === 'BLOCK') {
      trace.push({ rule: rule.id, kind: rule.kind, verdict: 'skipped', detail: 'a rule already refused this request' });
      continue;
    }
    let verdict = 'pass';
    let detail = '';

    switch (rule.kind) {
      case 'dustFloor': {
        const floor = rule.floor;
        const spendable = Math.max(0, wallet.balance - floor);
        if (effective > spendable) {
          verdict = 'clamp';
          // the clamp may only REDUCE the amount - never raise it
          effective = spendable;
          detail = `balance ${wallet.balance} minus the floor ${floor} leaves ${spendable}`;
        } else {
          detail = `balance ${wallet.balance} stays at or above the floor ${floor}`;
        }
        break;
      }
      case 'counterpartyAllowlist': {
        const allowed = (wallet.counterpartyAllow || []).includes(to);
        verdict = allowed ? 'pass' : 'fail';
        detail = allowed ? `${state.parties[to]?.name ?? to} is allowlisted` : `${state.parties[to]?.name ?? to} is not allowlisted`;
        if (!allowed) {
          decision = 'BLOCK';
          reason = rule.reason;
        }
        break;
      }
      case 'categoryAllowlist': {
        const allowed = (wallet.categories ?? rule.allow ?? []).includes(category);
        verdict = allowed ? 'pass' : 'fail';
        detail = allowed ? `the category "${category}" is allowed` : `the category "${category}" is not allowed`;
        if (!allowed) {
          decision = 'BLOCK';
          reason = rule.reason;
        }
        break;
      }
      case 'perTransaction': {
        const over = effective > rule.limit;
        verdict = over ? 'fail' : 'pass';
        detail = `${effective} against a per-transfer limit of ${rule.limit}`;
        if (over) {
          decision = 'BLOCK';
          reason = rule.reason;
        }
        break;
      }
      case 'perWindow': {
        const over = spentInWindow + effective > rule.limit;
        verdict = over ? 'fail' : 'pass';
        detail = `${spentInWindow} already spent in the window, ${effective} requested, limit ${rule.limit}`;
        if (over) {
          decision = 'BLOCK';
          reason = rule.reason;
        }
        break;
      }
      case 'perCounterparty': {
        const over = spentWithCounterparty + effective > rule.limit;
        verdict = over ? 'fail' : 'pass';
        detail = `${spentWithCounterparty} already sent to this counterparty, ${effective} requested, limit ${rule.limit}`;
        if (over) {
          decision = 'BLOCK';
          reason = rule.reason;
        }
        break;
      }
      default:
        verdict = 'unknown';
        detail = `unknown rule kind "${rule.kind}"`;
    }

    if (verdict === 'clamp' && decision === 'ALLOW') {
      decision = 'CLAMP';
      reason = rule.reason;
    }
    trace.push({ rule: rule.id, kind: rule.kind, verdict, detail });
  }

  if (effective < 0) effective = 0;
  return { decision, amount: effective, requested: amount, reason, trace };
}
