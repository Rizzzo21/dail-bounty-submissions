// Collective purchasing.
//
// A group of agents wants a shared good (in the demo: bulk compute credits). Each
// agent bids how many units it wants, what a unit is worth to it, and the most it
// is willing to spend. The market then picks the quantity that maximises the
// agents' total utility, applying a bulk discount tier and drawing on a shared
// social-money pool (the swarm treasury) as a subsidy.
//
// The search is exhaustive over a finite set of candidate quantities (prefix sums
// of the ranked bids plus every discount-tier threshold), so the result is
// deterministic and optimal *within that candidate set*.
import { allocateInteger } from './util.js';

export function unitPrice(unitBase, units, tiers = []) {
  let bps = 0;
  for (const tier of tiers) {
    if (units >= tier.minUnits && tier.discount_bps > bps) bps = tier.discount_bps;
  }
  return Math.round((unitBase * (10000 - bps)) / 10000);
}

function gini(values) {
  const xs = values.filter((v) => v >= 0).sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  const total = xs.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < xs.length; i += 1) cum += (i + 1) * xs[i];
  const n = xs.length;
  return (2 * cum) / (n * total) - (n + 1) / n;
}

function evaluate({ U, unitBase, tiers, bids, treasury, subsidyCap }) {
  if (U <= 0) return null;
  const price = unitPrice(unitBase, U, tiers);
  const eligible = bids.filter((b) => b.valuation_per_unit > price && b.max_spend > 0);
  if (eligible.length === 0) return null;

  let remaining = U;
  const raw = [];
  for (const bid of eligible) {
    if (remaining <= 0) break;
    const affordable = Math.floor(bid.max_spend / price);
    const take = Math.max(0, Math.min(remaining, bid.units, affordable));
    if (take > 0) {
      raw.push({ bid, units: take });
      remaining -= take;
    }
  }
  const totalUnits = raw.reduce((a, r) => a + r.units, 0);
  if (totalUnits === 0) return null;

  const gross = price * totalUnits;
  const subsidy = Math.max(0, Math.min(treasury, subsidyCap, gross));
  const netCost = gross - subsidy;

  // Split the (integer) net cost across agents proportionally to units, with the
  // largest-remainder method so the parts always sum to the whole.
  const parts = allocateInteger(netCost, raw.map((r) => r.units));
  const allocation = raw.map((r, i) => {
    const cost = parts[i];
    const utility = r.units * r.bid.valuation_per_unit - cost;
    return {
      agent_id: r.bid.agent_id,
      units: r.units,
      cost,
      valuation_per_unit: r.bid.valuation_per_unit,
      utility: Math.round(utility),
    };
  });

  const totalUtility = allocation.reduce((a, x) => a + x.utility, 0);
  return {
    units: totalUnits,
    unit_price: price,
    gross_cost: gross,
    subsidy,
    net_cost: netCost,
    treasury_spend: subsidy,
    vendor_spend: gross,
    allocation,
    total_utility: totalUtility,
    fairness_gini: Number(gini(allocation.map((a) => a.utility)).toFixed(4)),
  };
}

/**
 * Plan a collective purchase.
 *
 * @param {object} opts
 * @param {number} opts.treasury      uNEAR available in the shared social-money pool
 * @param {number} opts.subsidyCap    max uNEAR the pool may spend on this purchase
 * @param {number} opts.unitBase      list price of one unit (uNEAR)
 * @param {Array}  opts.tiers         [{minUnits, discount_bps}]
 * @param {Array}  opts.bids          [{agent_id, units, valuation_per_unit, max_spend}]
 */
export function planCollectivePurchase({ treasury = 0, subsidyCap = 0, unitBase, tiers = [], bids = [] }) {
  const ranked = [...bids].sort(
    (a, b) => b.valuation_per_unit - a.valuation_per_unit || a.agent_id.localeCompare(b.agent_id),
  );

  const candidates = new Set([0]);
  let acc = 0;
  for (const bid of ranked) {
    acc += bid.units;
    candidates.add(acc);
  }
  for (const tier of tiers) candidates.add(tier.minUnits);

  let best = null;
  for (const U of [...candidates].sort((a, b) => a - b)) {
    const plan = evaluate({ U, unitBase, tiers, bids: ranked, treasury, subsidyCap });
    if (!plan) continue;
    const better =
      !best ||
      plan.total_utility > best.total_utility ||
      (plan.total_utility === best.total_utility && plan.units < best.units);
    if (better) best = plan;
  }
  return best;
}
