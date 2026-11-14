// The test suite. `npm test` runs it with the Node standard test runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createParties, createState } from '../src/state.js';
import {
  accrueAction,
  clearParty,
  coverage,
  freezeParty,
  publishNav,
  redeemAction,
  registerAsset,
  signTransfer,
  stateFingerprint,
  subscribeAction,
  transferAction,
  verifyChain,
} from '../src/engine.js';
import { auditLedger, post } from '../src/ledger.js';
import { keypair, round } from '../src/util.js';

const T0 = 1800000000;
const DAY = 86400;
const MATURITY = T0 + 90 * DAY;
const ASSET = 't-bill-2026q4';

function setup() {
  const parties = createParties();
  const byName = new Map();
  for (const holder of parties.values()) byName.set(holder.name, holder);
  const addr = (name) => byName.get(name).address;
  const state = createState({ parties });
  registerAsset(state, {
    admin: addr('issuer'),
    id: ASSET,
    name: 'US Treasury Bill 2026Q4',
    kind: 'T-BILL',
    totalSupply: 1000000,
    maturity: MATURITY,
    yieldBps: 450,
    timestamp: T0,
  });
  for (const name of ['fund-avery', 'fund-birch', 'fund-cobalt', 'retail-dana']) {
    clearParty(state, { admin: addr('issuer'), address: addr(name), status: 'VERIFIED', timestamp: T0 });
  }
  return { state, addr };
}

test('a seed always produces the same address', () => {
  assert.equal(keypair('anchor-fund-avery').address, keypair('anchor-fund-avery').address);
  assert.notEqual(keypair('anchor-fund-avery').address, keypair('anchor-fund-birch').address);
});

test('only the registry may register an asset', () => {
  const { state, addr } = setup();
  assert.throws(
    () =>
      registerAsset(state, {
        admin: addr('fund-avery'),
        id: 'other',
        name: 'x',
        kind: 'T-BILL',
        totalSupply: 1,
        maturity: MATURITY,
        yieldBps: 1,
        timestamp: T0,
      }),
    /only the registry/,
  );
});

test('only the feed may publish a net asset value', () => {
  const { state, addr } = setup();
  assert.throws(() => publishNav(state, { feed: addr('fund-avery'), assetId: ASSET, nav: 1.1, timestamp: T0 }), /price feed/);
  assert.equal(publishNav(state, { feed: addr('feed'), assetId: ASSET, nav: 1.1, timestamp: T0 }), 1.1);
});

test('an uncleared party cannot subscribe', () => {
  const { state, addr } = setup();
  assert.throws(
    () => subscribeAction(state, { investor: addr('retail-eli'), assetId: ASSET, amount: 1000, timestamp: T0 }),
    /UNVERIFIED/,
  );
});

test('a party in a disallowed jurisdiction cannot hold the asset', () => {
  const { state, addr } = setup();
  clearParty(state, { admin: addr('issuer'), address: addr('retail-eli'), status: 'VERIFIED', timestamp: T0 });
  assert.throws(
    () => subscribeAction(state, { investor: addr('retail-eli'), assetId: ASSET, amount: 1000, timestamp: T0 }),
    /may not hold/,
  );
});

test('a subscription issues the units and backs them with cash', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  assert.equal(state.assets[ASSET].issued, 100000);
  assert.equal(state.balances[addr('fund-avery')], 400000);
  const cov = coverage(state, ASSET);
  assert.equal(cov.reserve, 100000);
  assert.equal(cov.claims, 100000);
  assert.equal(cov.covered, true);
});

test('the issue cap is enforced', () => {
  const { state, addr } = setup();
  // 500,000 + 300,000 = 800,000; the next subscription would pass the 1,000,000 cap
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 500000, timestamp: T0 });
  subscribeAction(state, { investor: addr('fund-birch'), assetId: ASSET, amount: 300000, timestamp: T0 });
  assert.throws(
    () => subscribeAction(state, { investor: addr('fund-cobalt'), assetId: ASSET, amount: 250000, timestamp: T0 }),
    /issue cap/,
  );
});

test('a subscriber without enough USDC is rejected', () => {
  const { state, addr } = setup();
  assert.throws(
    () => subscribeAction(state, { investor: addr('retail-dana'), assetId: ASSET, amount: 60001, timestamp: T0 }),
    /needs 60001/,
  );
});

test('the yield accrues per lot, so a transfer cannot reset the buyer\'s clock', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  subscribeAction(state, { investor: addr('retail-dana'), assetId: ASSET, amount: 5000, timestamp: T0 });

  // 60 days later the buyer picks up 2,000 more units from a secondary sale.
  publishNav(state, { feed: addr('feed'), assetId: ASSET, nav: 1.02, timestamp: T0 + 60 * DAY });
  const signature = signTransfer(state, addr('fund-avery'), {
    to: addr('retail-dana'), assetId: ASSET, units: 2000, timestamp: T0 + 60 * DAY,
  });
  transferAction(state, {
    from: addr('fund-avery'), to: addr('retail-dana'), assetId: ASSET,
    units: 2000, timestamp: T0 + 60 * DAY, signature,
  });

  accrueAction(state, { assetId: ASSET, timestamp: MATURITY });

  // Lot-correct: 5,000 units held for 90 days + 2,000 units held for 30 days.
  const dana = state.assets[ASSET].holders[addr('retail-dana')];
  // the total is rounded once, at the end - not once per lot
  const expected = round(5000 * 0.045 * (90 / 365) + 2000 * 0.045 * (30 / 365), 8);
  assert.equal(dana.units, 7000);
  assert.equal(dana.accrued, expected);
  assert.equal(Number(dana.accrued.toFixed(4)), 62.8767);
  assert.equal(dana.lots.length, 2, 'the buyer keeps one lot per acquisition');
  assert.deepEqual(dana.lots.map((lot) => lot.units), [5000, 2000]);
});

test('the seller keeps the coupon it earned before the transfer', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  const signature = signTransfer(state, addr('fund-avery'), {
    to: addr('retail-dana'), assetId: ASSET, units: 2000, timestamp: T0 + 60 * DAY,
  });
  transferAction(state, {
    from: addr('fund-avery'), to: addr('retail-dana'), assetId: ASSET,
    units: 2000, timestamp: T0 + 60 * DAY, signature,
  });
  accrueAction(state, { assetId: ASSET, timestamp: MATURITY });
  const avery = state.assets[ASSET].holders[addr('fund-avery')];
  // 100,000 units for 60 days, then 98,000 units for 30 days.
  const expected = round(100000 * 0.045 * (60 / 365) + 98000 * 0.045 * (30 / 365), 8);
  assert.equal(avery.units, 98000);
  assert.equal(avery.accrued, expected);
  assert.ok(avery.accrued > 1102.19 && avery.accrued < 1102.2, 'the pre-transfer coupon was not dropped');
});

test('a signed transfer cannot be replayed', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  subscribeAction(state, { investor: addr('retail-dana'), assetId: ASSET, amount: 50000, timestamp: T0 });
  const signature = signTransfer(state, addr('fund-avery'), {
    to: addr('retail-dana'), assetId: ASSET, units: 2000, timestamp: T0 + 10 * DAY,
  });
  transferAction(state, {
    from: addr('fund-avery'), to: addr('retail-dana'), assetId: ASSET,
    units: 2000, timestamp: T0 + 10 * DAY, signature,
  });
  const before = state.assets[ASSET].holders[addr('fund-avery')].units;
  assert.throws(
    () => transferAction(state, {
      from: addr('fund-avery'), to: addr('retail-dana'), assetId: ASSET,
      units: 2000, timestamp: T0 + 10 * DAY, signature,
    }),
    /already been executed|bad signature/,
  );
  assert.equal(state.assets[ASSET].holders[addr('fund-avery')].units, before, 'the replay moved no units');
  assert.equal(state.assets[ASSET].holders[addr('retail-dana')].units, 52000);
});

test('the yield accrues at the stated rate', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  accrueAction(state, { assetId: ASSET, timestamp: MATURITY });
  const holder = state.assets[ASSET].holders[addr('fund-avery')];
  const expected = round(100000 * 0.045 * (90 / 365), 8);
  assert.equal(holder.accrued, expected);
});

test('the reserve always covers the claims outstanding', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  subscribeAction(state, { investor: addr('fund-birch'), assetId: ASSET, amount: 250000, timestamp: T0 });
  accrueAction(state, { assetId: ASSET, timestamp: MATURITY });
  const cov = coverage(state, ASSET);
  assert.equal(cov.covered, true);
  assert.equal(cov.reserve, cov.claims);
});

test('a transfer moves units and USDC at the net asset value', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  publishNav(state, { feed: addr('feed'), assetId: ASSET, nav: 1.02, timestamp: T0 });
  const before = state.balances[addr('retail-dana')];
  const sig = signTransfer(state, addr('fund-avery'), {
    to: addr('retail-dana'),
    assetId: ASSET,
    units: 2000,
    timestamp: T0,
  });
  const result = transferAction(state, {
    from: addr('fund-avery'),
    to: addr('retail-dana'),
    assetId: ASSET,
    units: 2000,
    timestamp: T0,
    signature: sig,
  });
  assert.equal(result.price, 2040);
  assert.equal(state.balances[addr('retail-dana')], before - 2040);
  assert.equal(state.balances[addr('fund-avery')], 400000 + 2040);
  assert.equal(state.assets[ASSET].holders[addr('fund-avery')].units, 98000);
  assert.equal(state.assets[ASSET].holders[addr('retail-dana')].units, 2000);
});

test('a transfer without a valid signature is rejected', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  assert.throws(
    () =>
      transferAction(state, {
        from: addr('fund-avery'),
        to: addr('retail-dana'),
        assetId: ASSET,
        units: 1000,
        timestamp: T0,
        signature: 'deadbeef',
      }),
    /bad signature/,
  );
});

test('a transfer to an uncleared party is rejected', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  const sig = signTransfer(state, addr('fund-avery'), {
    to: addr('retail-eli'),
    assetId: ASSET,
    units: 1000,
    timestamp: T0,
  });
  assert.throws(
    () =>
      transferAction(state, {
        from: addr('fund-avery'),
        to: addr('retail-eli'),
        assetId: ASSET,
        units: 1000,
        timestamp: T0,
        signature: sig,
      }),
    /UNVERIFIED/,
  );
});

test('a frozen party cannot transfer', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  freezeParty(state, { admin: addr('issuer'), address: addr('fund-avery'), frozen: true, reason: 'review' });
  const sig = signTransfer(state, addr('fund-avery'), {
    to: addr('retail-dana'),
    assetId: ASSET,
    units: 1000,
    timestamp: T0,
  });
  assert.throws(
    () =>
      transferAction(state, {
        from: addr('fund-avery'),
        to: addr('retail-dana'),
        assetId: ASSET,
        units: 1000,
        timestamp: T0,
        signature: sig,
      }),
    /frozen/,
  );
});

test('redemption before maturity is rejected', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  assert.throws(
    () => redeemAction(state, { holder: addr('fund-avery'), assetId: ASSET, timestamp: T0 + 10 * DAY }),
    /matures at/,
  );
});

test('redemption pays face plus yield, less the registry fee', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  accrueAction(state, { assetId: ASSET, timestamp: MATURITY });
  const holder = state.assets[ASSET].holders[addr('fund-avery')];
  const accrued = holder.accrued;
  const before = state.balances[addr('fund-avery')];
  const result = redeemAction(state, { holder: addr('fund-avery'), assetId: ASSET, timestamp: MATURITY });
  assert.equal(result.gross, round(100000 + accrued, 8));
  assert.equal(result.fee, round((result.gross * 25) / 10000, 8));
  assert.equal(result.net, round(result.gross - result.fee, 8));
  assert.equal(state.balances[addr('fund-avery')], round(before + result.net, 8));
  assert.equal(state.ledger.accounts[`fee:${ASSET}`], result.fee);
});

test('the journal balances: debits equal credits, account by account', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  subscribeAction(state, { investor: addr('fund-birch'), assetId: ASSET, amount: 250000, timestamp: T0 });
  accrueAction(state, { assetId: ASSET, timestamp: MATURITY });
  redeemAction(state, { holder: addr('fund-avery'), assetId: ASSET, timestamp: MATURITY });
  const audit = auditLedger(state.ledger);
  assert.equal(audit.ok, true);
  assert.equal(audit.debit, audit.credit);
  assert.deepEqual(audit.mismatched, []);
});

test('an unbalanced journal entry is refused', () => {
  const { state } = setup();
  assert.throws(
    () => post(state.ledger, { memo: 'bad', legs: [{ account: 'a', debit: 100 }] }),
    /unbalanced/,
  );
});

test('the event log is an unbroken hash chain', () => {
  const { state, addr } = setup();
  subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
  const chain = verifyChain(state);
  assert.equal(chain.ok, true);
  assert.equal(state.events[0].prevHash, '0'.repeat(64));
});

test('a rejected action is still recorded in the log', () => {
  const { state, addr } = setup();
  try {
    subscribeAction(state, { investor: addr('retail-eli'), assetId: ASSET, amount: 100, timestamp: T0 });
  } catch {
    // expected
  }
  const rejections = state.events.filter((e) => e.type === 'action_rejected');
  assert.equal(rejections.length, 1);
  assert.match(rejections[0].payload.reason, /UNVERIFIED/);
});

test('the same run twice gives the same state hash', () => {
  const run = () => {
    const { state, addr } = setup();
    subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
    accrueAction(state, { assetId: ASSET, timestamp: MATURITY });
    redeemAction(state, { holder: addr('fund-avery'), assetId: ASSET, timestamp: MATURITY });
    return stateFingerprint(state);
  };
  assert.equal(run(), run());
});

test('a replay of the same actions reproduces the same event hashes', () => {
  const run = () => {
    const { state, addr } = setup();
    subscribeAction(state, { investor: addr('fund-avery'), assetId: ASSET, amount: 100000, timestamp: T0 });
    accrueAction(state, { assetId: ASSET, timestamp: MATURITY });
    return state.events.map((e) => e.hash).join('|');
  };
  assert.equal(run(), run());
});
