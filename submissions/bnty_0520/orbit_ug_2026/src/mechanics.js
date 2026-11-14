// The three mechanics of the token: the pool (price), the supply (community
// reactive) and the treasury (rules). Pure functions over the state object.
import { round } from './util.js';

export function price(pool) {
  return pool.y / pool.x; // USDC per token
}

// One place that quotes a swap and one place that executes it, so the printed
// numbers and the state can never drift apart.
//
// The fee is always charged in USDC (the quote asset) and always goes to the
// treasury. The howl tax is always charged in TOKENS and is always burned.
// Both directions therefore move tokens and USDC in a way that balances:
//
//   y_to_x (USDC in, tokens out): the trader pays USDC, the pool keeps the
//     USDC minus the fee, the trader receives the tokens minus the howl tax.
//   x_to_y (tokens in, USDC out): the trader pays tokens, the pool keeps them
//     minus the howl tax, the trader receives the USDC minus the fee.
export function quoteSwap(state, dir, amountIn) {
  const p = state.params;
  const howlOpen = state.epoch <= state.howlUntilEpoch;
  if (dir === 'y_to_x') {
    const fee = round((amountIn * state.pool.feeBps) / 10000, 8);
    const netIn = round(amountIn - fee, 8);
    const out = round((state.pool.y * netIn) / (state.pool.x + netIn), 8);
    const howlTax = howlOpen ? round((out * p.howlTaxBps) / 10000, 8) : 0;
    return { out, fee, howlTax, netIn, netOut: round(out - howlTax, 8) };
  }
  const howlTax = howlOpen ? round((amountIn * p.howlTaxBps) / 10000, 8) : 0;
  const netIn = round(amountIn - howlTax, 8);
  const out = round((state.pool.x * netIn) / (state.pool.y + netIn), 8);
  const fee = round((out * state.pool.feeBps) / 10000, 8);
  return { out, fee, howlTax, netIn, netOut: round(out - fee, 8) };
}

// Execute a swap: reserves move, the trader is credited, the fee goes to the
// treasury in USDC and the howl tax is burned.
export function applySwap(state, { trader, dir, amountIn }) {
  const q = quoteSwap(state, dir, amountIn);
  if (dir === 'y_to_x') {
    state.usdc[trader] = round((state.usdc[trader] ?? 0) - amountIn, 8);
    state.pool.y = round(state.pool.y + q.netIn, 8);
    state.pool.x = round(state.pool.x - q.out, 8);
    state.balances[trader] = round((state.balances[trader] ?? 0) + q.netOut, 8);
  } else {
    state.balances[trader] = round((state.balances[trader] ?? 0) - amountIn, 8);
    state.usdc[trader] = round((state.usdc[trader] ?? 0) + q.netOut, 8);
    state.pool.x = round(state.pool.x + q.netIn, 8);
    state.pool.y = round(state.pool.y - q.out, 8);
  }
  state.treasury.usdc = round(state.treasury.usdc + q.fee, 8);
  state.treasury.fees = round(state.treasury.fees + q.fee, 8);
  if (q.howlTax) state.supply = round(state.supply - q.howlTax, 8);
  return { amountOut: q.out, fee: q.fee, howlTax: q.howlTax };
}

// CHANT: mint in proportion to how much of the community took part, then split
// the mint between the signers (sqrt of their stake) and the steward.
export function applyChant(state, { signers, eligibleHolders }) {
  const p = state.params;
  const participation = eligibleHolders > 0 ? signers.length / eligibleHolders : 0;
  const minted = round(Math.min(p.mintCap, p.mintCap * participation), 0);
  const stewardCut = round((minted * p.stewardBps) / 10000, 0);
  const pot = minted - stewardCut;
  // The mint is split by stake (square root of the holding), not by vote weight:
  // voting is capped so a whale cannot buy a ritual, but a holder that did the
  // work gets a bigger share of what the ritual minted.
  const weights = signers.map((s) => Math.sqrt(Math.max(s.stake ?? 0, 0)));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const payouts = signers.map((s, i) => round((pot * weights[i]) / totalWeight, 0));
  // the rounding remainder goes to the first signer so the minted total is exact
  const paid = payouts.reduce((a, b) => a + b, 0);
  if (payouts.length) payouts[0] += pot - paid;

  for (let i = 0; i < signers.length; i++) {
    const addr = signers[i].address;
    state.balances[addr] = round((state.balances[addr] ?? 0) + payouts[i], 8);
  }
  state.balances[state.steward] = round((state.balances[state.steward] ?? 0) + stewardCut, 8);
  state.supply = round(state.supply + minted, 8);

  const fees = signers.length * p.chantFee;
  for (const s of signers) {
    state.balances[s.address] = round(state.balances[s.address] - p.chantFee, 8);
  }
  state.treasury.tokens = round(state.treasury.tokens + fees, 8);
  state.treasury.ritualFees = round(state.treasury.ritualFees + fees, 8);

  return { minted, stewardCut, participation, fees, payouts };
}

// BURN: every signer destroys a fixed amount. Supply contracts because the
// tokens leave the circulating set for good.
export function applyBurn(state, { signers }) {
  const p = state.params;
  let burned = 0;
  for (const s of signers) {
    const take = Math.min(p.burnPerSigner, state.balances[s.address] ?? 0);
    state.balances[s.address] = round(state.balances[s.address] - take, 8);
    burned += take;
  }
  state.supply = round(state.supply - burned, 8);
  return { burned };
}

// Treasury rule 2 (buyback): above the USDC ceiling the treasury buys tokens
// with the fees it collected and burns them. This is what makes the supply
// react to real usage rather than to hype: every trade funds the burn.
export function applyBuyback(state) {
  const p = state.params;
  if (state.treasury.usdc <= p.treasuryCeiling) return null;
  const spend = round(state.treasury.usdc - p.treasuryCeiling, 8);
  // the protocol does not charge itself a fee
  const amountOut = round((state.pool.y * spend) / (state.pool.x + spend), 8);
  state.pool.y = round(state.pool.y + spend, 8);
  state.pool.x = round(state.pool.x - amountOut, 8);
  state.treasury.usdc = round(state.treasury.usdc - spend, 8);
  state.supply = round(state.supply - amountOut, 8);
  state.treasury.boughtBackBurned = round(state.treasury.boughtBackBurned + amountOut, 8);
  return { spent: spend, burned: amountOut };
}
