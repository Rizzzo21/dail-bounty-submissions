import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCollectivePurchase, unitPrice } from '../src/collective.js';

const TIERS = [
  { minUnits: 3, discount_bps: 1000 },
  { minUnits: 6, discount_bps: 2200 },
];

test('bulk discounts lower the unit price', () => {
  assert.equal(unitPrice(900_000, 1, TIERS), 900_000);
  assert.equal(unitPrice(900_000, 3, TIERS), 810_000);
  assert.equal(unitPrice(900_000, 6, TIERS), 702_000);
  assert.equal(unitPrice(900_000, 10, TIERS), 702_000);
});

test('a plan splits the units and charges each agent its share', () => {
  const plan = planCollectivePurchase({
    treasury: 5_000_000,
    subsidyCap: 2_000_000,
    unitBase: 900_000,
    tiers: TIERS,
    bids: [
      { agent_id: 'a.near', units: 2, valuation_per_unit: 1_000_000, max_spend: 2_000_000 },
      { agent_id: 'b.near', units: 2, valuation_per_unit: 950_000, max_spend: 2_000_000 },
      { agent_id: 'c.near', units: 1, valuation_per_unit: 800_000, max_spend: 900_000 },
    ],
  });
  assert.ok(plan);
  const totalUnits = plan.allocation.reduce((a, x) => a + x.units, 0);
  assert.equal(totalUnits, plan.units);
  const totalCost = plan.allocation.reduce((a, x) => a + x.cost, 0);
  assert.equal(totalCost, plan.net_cost);
  // the vendor gets the gross, the treasury covers the subsidy
  assert.equal(plan.vendor_spend, plan.gross_cost);
  assert.equal(plan.treasury_spend, plan.subsidy);
  assert.ok(plan.subsidy <= 2_000_000);
});

test('no agent pays more than its max_spend', () => {
  const plan = planCollectivePurchase({
    treasury: 1_000_000,
    subsidyCap: 500_000,
    unitBase: 900_000,
    tiers: TIERS,
    bids: [
      { agent_id: 'a.near', units: 3, valuation_per_unit: 1_200_000, max_spend: 1_500_000 },
      { agent_id: 'b.near', units: 3, valuation_per_unit: 1_100_000, max_spend: 1_500_000 },
    ],
  });
  assert.ok(plan);
  for (const alloc of plan.allocation) {
    assert.ok(alloc.cost <= 1_500_000, `${alloc.agent_id} paid ${alloc.cost}`);
  }
});

test('agents that value a unit below the price do not get one', () => {
  const plan = planCollectivePurchase({
    treasury: 0,
    subsidyCap: 0,
    unitBase: 900_000,
    tiers: [],
    bids: [
      { agent_id: 'rich.near', units: 2, valuation_per_unit: 2_000_000, max_spend: 4_000_000 },
      { agent_id: 'poor.near', units: 2, valuation_per_unit: 100_000, max_spend: 4_000_000 },
    ],
  });
  assert.ok(plan);
  assert.equal(plan.allocation.length, 1);
  assert.equal(plan.allocation[0].agent_id, 'rich.near');
});

test('the social-money subsidy increases total utility', () => {
  const bids = [
    { agent_id: 'a.near', units: 2, valuation_per_unit: 1_000_000, max_spend: 2_000_000 },
    { agent_id: 'b.near', units: 2, valuation_per_unit: 1_000_000, max_spend: 2_000_000 },
  ];
  const without = planCollectivePurchase({
    treasury: 0,
    subsidyCap: 0,
    unitBase: 900_000,
    tiers: TIERS,
    bids,
  });
  const withSubsidy = planCollectivePurchase({
    treasury: 2_000_000,
    subsidyCap: 1_000_000,
    unitBase: 900_000,
    tiers: TIERS,
    bids,
  });
  assert.ok(withSubsidy.total_utility > without.total_utility);
});

test('no plan when nobody wants the goods', () => {
  const plan = planCollectivePurchase({
    treasury: 1_000_000,
    subsidyCap: 1_000_000,
    unitBase: 900_000,
    tiers: [],
    bids: [{ agent_id: 'a.near', units: 1, valuation_per_unit: 10, max_spend: 100 }],
  });
  assert.equal(plan, null);
});

test('the plan is deterministic', () => {
  const args = {
    treasury: 3_000_000,
    subsidyCap: 1_000_000,
    unitBase: 900_000,
    tiers: TIERS,
    bids: [
      { agent_id: 'a.near', units: 2, valuation_per_unit: 1_000_000, max_spend: 2_000_000 },
      { agent_id: 'b.near', units: 2, valuation_per_unit: 950_000, max_spend: 2_000_000 },
    ],
  };
  assert.deepEqual(planCollectivePurchase(args), planCollectivePurchase(args));
});
