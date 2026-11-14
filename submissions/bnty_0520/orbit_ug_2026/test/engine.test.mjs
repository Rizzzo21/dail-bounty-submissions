// The test suite. `npm test` runs it with the Node standard test runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCast, createState } from '../src/state.js';
import {
  applyRitual,
  applySwapAction,
  advanceEpoch,
  stateFingerprint,
  verifyChain,
} from '../src/engine.js';
import { ritualIdFor, ritualPayload, paramsHash, voteWeight } from '../src/ritual.js';
import { keypair, sign, verify, round } from '../src/util.js';
import { price, quoteSwap } from '../src/mechanics.js';

const cast = createCast();
const keys = {};
for (const holder of cast.values()) keys[holder.address] = holder.publicKey;
const member = (name) => {
  for (const holder of cast.values()) if (holder.name === name) return holder;
  throw new Error(`no member ${name}`);
};
const PARAMS = { poolFeeBps: 300, mintCap: 500000, treasuryFloor: 2000, treasuryCeiling: 3000 };
const fresh = () => createState({ cast, pool: { x: 2_000_000, y: 800_000 }, params: PARAMS });

function signRitual(state, kind, epoch, members) {
  const ritualId = ritualIdFor(state, kind, epoch, members.map((m) => m.address));
  const ph = paramsHash(state);
  return members.map((m) => ({
    address: m.address,
    sig: sign(m.privateKey, ritualPayload({ kind, epoch, ritualId, address: m.address, paramsHash: ph })),
  }));
}

const supplyOf = (state) =>
  Object.values(state.balances).reduce((a, b) => a + b, 0) + state.pool.x + state.treasury.tokens;

test('a seed always produces the same address', () => {
  const a = keypair('ritual-mara');
  const b = keypair('ritual-mara');
  assert.equal(a.address, b.address);
  assert.notEqual(a.address, keypair('ritual-ivo').address);
});

test('a signature verifies, and a tampered payload does not', () => {
  const kp = keypair('ritual-test');
  const sig = sign(kp.privateKey, 'hello');
  assert.equal(verify(kp.publicKey, 'hello', sig), true);
  assert.equal(verify(kp.publicKey, 'hello!', sig), false);
});

test('a holder below minStake cannot sign a ritual', () => {
  const state = fresh();
  const pauper = { address: member('steward').address, privateKey: member('steward').privateKey };
  state.balances[pauper.address] = 10;
  const signers = signRitual(state, 'CHANT', 1, [pauper]);
  assert.throws(() => applyRitual(state, keys, { kind: 'CHANT', epoch: 1, signers }), /below minStake/);
});

test('one address cannot vote twice in the same epoch', () => {
  const state = fresh();
  const mara = member('mara');
  applyRitual(state, keys, { kind: 'CHANT', epoch: 1, signers: signRitual(state, 'CHANT', 1, [mara]) });
  assert.throws(
    () => applyRitual(state, keys, { kind: 'CHANT', epoch: 1, signers: signRitual(state, 'CHANT', 1, [mara]) }),
    /already voted/,
  );
});

test('a ritual without quorum changes nothing', () => {
  const state = fresh();
  const before = state.supply;
  const ritual = applyRitual(state, keys, {
    kind: 'BURN',
    epoch: 1,
    signers: signRitual(state, 'BURN', 1, [member('mara'), member('ivo')]),
  });
  assert.equal(ritual.status, 'pending');
  assert.equal(state.supply, before);
  assert.ok(ritual.votes < state.params.quorumVotes);
});

test('a ritual that reaches quorum mints exactly cap x participation', () => {
  const state = fresh();
  const chanters = ['mara', 'ivo', 'sana', 'tomas', 'wren', 'kofi'].map(member);
  const before = state.supply;
  const ritual = applyRitual(state, keys, { kind: 'CHANT', epoch: 1, signers: signRitual(state, 'CHANT', 1, chanters) });
  assert.equal(ritual.status, 'fired');
  const fired = state.events.find((e) => e.type === 'chant_fired').payload;
  // the eligible-holder count is the one the settlement used, not one recomputed later
  assert.equal(fired.minted, Math.round(state.params.mintCap * (chanters.length / fired.eligibleHolders)));
  // minted by the ritual + whatever the treasury's liquidity floor had to mint
  const floorMint = state.treasury.mintedForFloor;
  assert.equal(state.supply - before, fired.minted + floorMint);
  assert.equal(floorMint, state.params.treasuryFloor - fired.chantFees);
  assert.equal(state.balances[state.steward], fired.stewardCut);
});

test('the mint is split by stake, not equally', () => {
  const state = fresh();
  const chanters = [member('mara'), member('orca'), member('lin')];
  const ritual = applyRitual(state, keys, { kind: 'CHANT', epoch: 1, signers: signRitual(state, 'CHANT', 1, chanters) });
  const fired = state.events.find((e) => e.type === 'chant_fired').payload;
  const byStake = [...chanters].sort((a, b) => b.balance - a.balance);
  const gains = byStake.map((c) => state.balances[c.address] - c.balance);
  assert.ok(gains[0] > gains[1], 'the bigger holder gets more of the mint');
  assert.ok(gains[1] > gains[2]);
  // the gains are net of the chant fee each signer paid
  const fees = chanters.length * state.params.chantFee;
  assert.equal(gains.reduce((a, b) => a + b, 0) + fees + fired.stewardCut, fired.minted);
});

test('a BURN ritual contracts the supply', () => {
  const state = fresh();
  const before = state.supply;
  applyRitual(state, keys, {
    kind: 'BURN',
    epoch: 1,
    signers: signRitual(state, 'BURN', 1, [member('mara'), member('ivo'), member('sana')]),
  });
  const burned = state.events.find((e) => e.type === 'burn_fired').payload;
  assert.equal(burned.burned, 3 * state.params.burnPerSigner);
  assert.equal(state.supply, before - burned.burned + state.treasury.mintedForFloor);
});

test('a howl window burns a share of every trade, and only then', () => {
  const state = fresh();
  const trader = member('wren');
  const plain = applySwapAction(state, { trader: trader.address, dir: 'y_to_x', amountIn: 50000 });
  assert.equal(plain.howlTax, 0);
  applyRitual(state, keys, {
    kind: 'HOWL',
    epoch: 1,
    signers: signRitual(state, 'HOWL', 1, [member('mara'), member('ivo'), member('sana')]),
  });
  const howled = applySwapAction(state, { trader: trader.address, dir: 'y_to_x', amountIn: 50000 });
  // the tax is taken out of the output, in tokens
  assert.equal(howled.howlTax, round((howled.amountOut * state.params.howlTaxBps) / 10000, 8));
  assert.ok(howled.howlTax > 0);
});

test('trading fees are collected by the treasury in USDC', () => {
  const state = fresh();
  const before = state.treasury.usdc;
  let expected = 0;
  for (let i = 0; i < 4; i++) {
    const q = quoteSwap(state, 'y_to_x', 80000);
    expected += q.fee;
    applySwapAction(state, { trader: member('whale').address, dir: 'y_to_x', amountIn: 80000 });
  }
  assert.ok(expected > 0);
  assert.equal(round(state.treasury.usdc - before, 8), round(expected, 8));
  assert.equal(state.treasury.fees, state.treasury.usdc);
});

test('the treasury mints itself up to its token floor', () => {
  const state = fresh();
  const before = state.treasury.tokens;
  applyRitual(state, keys, {
    kind: 'CHANT',
    epoch: 1,
    signers: signRitual(state, 'CHANT', 1, [member('mara'), member('ivo'), member('sana')]),
  });
  // the chant fees landed in the treasury first, so the floor had less to mint
  const chantFees = 3 * state.params.chantFee;
  assert.equal(state.treasury.tokens, state.params.treasuryFloor);
  assert.equal(state.treasury.mintedForFloor, state.params.treasuryFloor - before - chantFees);
});

test('above the ceiling the treasury buys tokens back and burns them', () => {
  const state = fresh();
  for (let i = 0; i < 8; i++) {
    applySwapAction(state, { trader: member('whale').address, dir: 'y_to_x', amountIn: 80000 });
  }
  const poolBefore = state.pool.x;
  const supplyBefore = state.supply;
  applyRitual(state, keys, {
    kind: 'CHANT',
    epoch: 1,
    signers: signRitual(state, 'CHANT', 1, [member('mara'), member('ivo'), member('sana')]),
  });
  const bb = state.events.find((e) => e.type === 'treasury_rule_buyback');
  assert.ok(bb, 'the buyback rule fired');
  assert.ok(bb.payload.spent > 0, 'the treasury spent USDC it collected as fees');
  assert.ok(bb.payload.burned > 0);
  assert.ok(state.pool.x < poolBefore, 'the bought tokens left the pool');
  // supply after the ritual = before + the ritual's mint + the floor mint - the buyback burn
  const chant = state.events.find((e) => e.type === 'chant_fired');
  const floor = state.events.find((e) => e.type === 'treasury_rule_liquidity_floor');
  const expected =
    supplyBefore + chant.payload.minted + (floor ? floor.payload.minted : 0) - bb.payload.burned;
  assert.ok(Math.abs(state.supply - expected) < 1e-6, `supply ${state.supply} vs expected ${expected}`);
  assert.ok(state.treasury.usdc <= state.params.treasuryCeiling + 1e-6);
});

test('the constant product never decreases (the fee keeps it growing)', () => {
  const state = fresh();
  const k = state.pool.x * state.pool.y;
  for (let i = 0; i < 10; i++) {
    applySwapAction(state, { trader: member('whale').address, dir: 'y_to_x', amountIn: 10000 });
    applySwapAction(state, { trader: member('wren').address, dir: 'x_to_y', amountIn: 500 });
  }
  assert.ok(state.pool.x * state.pool.y >= k - 1e-6);
});

test('buying tokens pushes the price up (regression: the reserves were inverted once)', () => {
  const state = fresh();
  const before = price(state.pool);
  applySwapAction(state, { trader: member('whale').address, dir: 'y_to_x', amountIn: 80000 });
  assert.ok(price(state.pool) > before, 'price rose after buying tokens');
  const p2 = price(state.pool);
  applySwapAction(state, { trader: member('wren').address, dir: 'x_to_y', amountIn: 1000 });
  assert.ok(price(state.pool) < p2, 'selling tokens pushes the price down');
});

test('the event log is an unbroken hash chain', () => {
  const state = fresh();
  applyRitual(state, keys, {
    kind: 'CHANT',
    epoch: 1,
    signers: signRitual(state, 'CHANT', 1, [member('mara'), member('ivo'), member('sana')]),
  });
  applySwapAction(state, { trader: member('whale').address, dir: 'y_to_x', amountIn: 80000 });
  const chain = verifyChain(state);
  assert.equal(chain.ok, true);
  assert.equal(chain.length, state.events.length);
  assert.equal(state.events[0].prevHash, '0'.repeat(64));
});

test('the same run twice gives the same state hash', () => {
  const run = () => {
    const state = fresh();
    applyRitual(state, keys, {
      kind: 'CHANT',
      epoch: 1,
      signers: signRitual(state, 'CHANT', 1, [member('mara'), member('ivo'), member('sana')]),
    });
    applySwapAction(state, { trader: member('whale').address, dir: 'y_to_x', amountIn: 80000 });
    advanceEpoch(state);
    return stateFingerprint(state);
  };
  assert.equal(run(), run());
});

test('supply accounting balances: supply == balances + pool + treasury', () => {
  const state = fresh();
  applyRitual(state, keys, {
    kind: 'CHANT',
    epoch: 1,
    signers: signRitual(state, 'CHANT', 1, [member('mara'), member('ivo'), member('sana'), member('tomas')]),
  });
  for (let i = 0; i < 6; i++) {
    applySwapAction(state, { trader: member('whale').address, dir: 'y_to_x', amountIn: 40000 });
  }
  // one vote per address per epoch: the next ritual needs the next epoch
  advanceEpoch(state);
  applyRitual(state, keys, {
    kind: 'BURN',
    epoch: state.epoch,
    signers: signRitual(state, 'BURN', state.epoch, [member('mara'), member('ivo'), member('sana')]),
  });
  advanceEpoch(state);
  applyRitual(state, keys, {
    kind: 'HOWL',
    epoch: state.epoch,
    signers: signRitual(state, 'HOWL', state.epoch, [member('mara'), member('ivo'), member('sana')]),
  });
  applySwapAction(state, { trader: member('wren').address, dir: 'y_to_x', amountIn: 50000 });
  assert.ok(Math.abs(supplyOf(state) - state.supply) < 1e-6, `supply ${state.supply} vs accounted ${supplyOf(state)}`);
});

test('a whale vote counts the same as anyone else', () => {
  assert.equal(voteWeight(5_000_000), 1);
  assert.equal(voteWeight(100_000), 1);
  assert.ok(voteWeight(100) < voteWeight(10_000));
  assert.ok(voteWeight(100_000) === voteWeight(5_000_000), 'the whale gets no extra vote');
});

test('the same action sequence always produces the same trace', () => {
  const run = () => {
    const state = fresh();
    applyRitual(state, keys, {
      kind: 'CHANT',
      epoch: 1,
      signers: signRitual(state, 'CHANT', 1, [member('mara'), member('ivo'), member('sana')]),
    });
    applySwapAction(state, { trader: member('whale').address, dir: 'y_to_x', amountIn: 80000 });
    return state.events.map((e) => e.hash).join('|');
  };
  assert.equal(run(), run());
});

test('the quote is a constant product, and the fee is taken out of the USDC input', () => {
  const state = fresh();
  const q = quoteSwap(state, 'y_to_x', 10_000);
  assert.equal(q.fee, round((10_000 * state.pool.feeBps) / 10000, 8));
  assert.equal(q.out, round((state.pool.y * (10_000 - q.fee)) / (state.pool.x + (10_000 - q.fee)), 8));
  assert.equal(q.netOut + q.howlTax, q.out);
});

test('a swap never creates or destroys tokens outside the howl tax', () => {
  const state = fresh();
  const before = state.supply;
  applySwapAction(state, { trader: member('whale').address, dir: 'y_to_x', amountIn: 40_000 });
  assert.equal(state.supply, before);
  const other = fresh();
  const b2 = other.supply;
  applySwapAction(other, { trader: member('wren').address, dir: 'x_to_y', amountIn: 1_000 });
  assert.equal(other.supply, b2);
});
