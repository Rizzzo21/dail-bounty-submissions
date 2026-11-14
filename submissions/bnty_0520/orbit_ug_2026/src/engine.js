// The engine: every state change goes through here, and every state change
// appends a hash-chained event. Replaying the events from the initial state
// reproduces the final state hash exactly (see test/engine.test.mjs).
import { hash, round } from './util.js';
import { applySwap, applyChant, applyBurn, applyBuyback, price } from './mechanics.js';
import { checkSigner, paramsHash, ritualIdFor } from './ritual.js';

export function emit(state, type, payload) {
  const seq = state.eventCount;
  const prevHash = state.lastHash;
  const value = hash({ seq, type, payload, prevHash });
  const event = { seq, type, payload, prevHash, hash: value };
  state.events.push(event);
  state.eventCount += 1;
  state.lastHash = value;
  return event;
}

// Fingerprint of the economic state (the event log is summarised separately).
export function stateFingerprint(state) {
  return hash({
    epoch: state.epoch,
    supply: state.supply,
    balances: state.balances,
    treasury: state.treasury,
    pool: state.pool,
    rituals: state.rituals,
    params: state.params,
  });
}

export function applySwapAction(state, { trader, dir, amountIn }) {
  const res = applySwap(state, { trader, dir, amountIn });
  emit(state, 'swap', {
    trader,
    dir,
    amountIn,
    amountOut: res.amountOut,
    fee: res.fee,
    howlTax: res.howlTax,
    priceAfter: round(price(state.pool), 8),
    supplyAfter: state.supply,
  });
  return res;
}

// Add signatures to the (possibly new) ritual for (kind, epoch). When the
// quorum is reached the ritual fires immediately.
export function applyRitual(state, keys, { kind, epoch, signers }) {
  const addresses = signers.map((s) => s.address);
  const ritualId = ritualIdFor(state, kind, epoch, addresses);
  let ritual = state.rituals.find((r) => r.id === ritualId);
  if (!ritual) {
    ritual = { id: ritualId, kind, epoch, signers: [], votes: 0, status: 'pending', firedAt: null };
    state.rituals.push(ritual);
    emit(state, 'ritual_opened', { ritual: ritualId, kind, epoch });
  }
  if (!state.votesThisEpoch[epoch]) state.votesThisEpoch[epoch] = [];
  for (const signer of signers) {
    const check = checkSigner(state, keys, { ...signer, kind, epoch, ritualId });
    if (!check.ok) {
      emit(state, 'ritual_rejected', { ritual: ritualId, address: signer.address, reason: check.reason });
      const err = new Error(check.reason);
      err.code = 'SIGNER_REJECTED';
      throw err;
    }
    ritual.signers.push({ address: signer.address, weight: check.weight, stake: check.stake, sig: signer.sig });
    state.votesThisEpoch[epoch].push(signer.address);
    emit(state, 'ritual_signed', {
      ritual: ritualId,
      kind,
      epoch,
      address: signer.address,
      weight: check.weight,
      votes: ritual.signers.length,
    });
  }
  ritual.votes = round(ritual.signers.reduce((a, s) => a + s.weight, 0), 4);
  if (ritual.votes >= state.params.quorumVotes) fireRitual(state, ritual);
  return ritual;
}

// The two treasury rules, always in this order.
//   R1 liquidity floor - the treasury mints itself tokens up to the floor, so
//      it always holds a float of the token it governs
//   R2 buyback         - above the USDC ceiling it buys tokens with the fees
//      it collected and burns them
export function applyTreasuryRules(state, ritualId) {
  const p = state.params;
  if (state.treasury.tokens < p.treasuryFloor) {
    const minted = round(p.treasuryFloor - state.treasury.tokens, 8);
    state.treasury.tokens = round(state.treasury.tokens + minted, 8);
    state.treasury.mintedForFloor = round(state.treasury.mintedForFloor + minted, 8);
    state.supply = round(state.supply + minted, 8);
    emit(state, 'treasury_rule_liquidity_floor', {
      ritual: ritualId,
      minted,
      treasuryTokens: state.treasury.tokens,
      supplyAfter: state.supply,
    });
  }
  const buyback = applyBuyback(state);
  if (buyback) {
    emit(state, 'treasury_rule_buyback', {
      ritual: ritualId,
      spent: buyback.spent,
      burned: buyback.burned,
      treasuryUsdc: state.treasury.usdc,
      supplyAfter: state.supply,
    });
  }
}

export function fireRitual(state, ritual) {
  const signers = ritual.signers.map((s) => ({ address: s.address, weight: s.weight, stake: s.stake }));
  if (ritual.kind === 'CHANT') {
    const eligibleHolders = Object.values(state.balances).filter((b) => b >= state.params.minStake).length;
    const result = applyChant(state, { signers, eligibleHolders });
    emit(state, 'chant_fired', {
      ritual: ritual.id,
      signers: signers.length,
      eligibleHolders,
      participation: round(result.participation, 6),
      minted: result.minted,
      stewardCut: result.stewardCut,
      chantFees: result.fees,
      supplyAfter: state.supply,
    });
  } else if (ritual.kind === 'BURN') {
    const result = applyBurn(state, { signers });
    emit(state, 'burn_fired', {
      ritual: ritual.id,
      signers: signers.length,
      burned: result.burned,
      supplyAfter: state.supply,
    });
  } else if (ritual.kind === 'HOWL') {
    state.howlUntilEpoch = state.epoch + 1;
    emit(state, 'howl_fired', {
      ritual: ritual.id,
      windowUntilEpoch: state.howlUntilEpoch,
      note: 'while the window is open, pool fees carry an extra howl tax that is burned',
    });
  } else {
    throw new Error(`unknown ritual kind ${ritual.kind}`);
  }
  ritual.status = 'fired';
  ritual.firedAt = { epoch: state.epoch, seq: state.eventCount };
  applyTreasuryRules(state, ritual.id);
  emit(state, 'ritual_settled', {
    ritual: ritual.id,
    supply: state.supply,
    treasuryTokens: state.treasury.tokens,
    treasuryUsdc: state.treasury.usdc,
    price: round(price(state.pool), 8),
  });
  return ritual;
}

export function advanceEpoch(state) {
  state.epoch += 1;
  state.votesThisEpoch = {};
  emit(state, 'epoch_advanced', { epoch: state.epoch });
  return state;
}

// Sanity check that the event log is an unbroken hash chain.
export function verifyChain(state) {
  let prev = '0'.repeat(64);
  for (const event of state.events) {
    if (event.prevHash !== prev) return { ok: false, at: event.seq, reason: 'prevHash mismatch' };
    const value = hash({ seq: event.seq, type: event.type, payload: event.payload, prevHash: event.prevHash });
    if (value !== event.hash) return { ok: false, at: event.seq, reason: 'event hash mismatch' };
    prev = event.hash;
  }
  return { ok: true, length: state.events.length, head: prev };
}
