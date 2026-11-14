// The asset logic: subscribing, accruing yield, transferring and redeeming.
//
// Everything here is a pure function of the state, and every movement of value
// is posted to the double-entry journal in src/ledger.js. The timestamps are
// always supplied by the caller - there is no wall clock anywhere - so the
// whole registry replays identically on any machine.
import { hash, round, verify } from './util.js';
import { post } from './ledger.js';
import { canHold } from './compliance.js';

export const ACCOUNTS = {
  wallet: (address) => `wallet:${address}`,
  reserve: (assetId) => `reserve:${assetId}`,
  fee: (assetId) => `fee:${assetId}`,
  position: (assetId, address) => `position:${assetId}:${address}`,
  issued: (assetId) => `issued:${assetId}`,
  yieldObligation: (assetId) => `yield:${assetId}`,
  couponIncome: () => 'coupon:income',
};

export function assetOf(state, assetId) {
  const asset = state.assets[assetId];
  if (!asset) throw new Error(`unknown asset ${assetId}`);
  return asset;
}

export function holderOf(asset, address) {
  if (!asset.holders[address]) {
    // A position is a list of LOTS. Each lot remembers when its units were
    // acquired, so the yield accrues per lot: units bought 90 days ago earn
    // 90 days of coupon, units bought yesterday earn one day. A single clock
    // per holder would let a transfer reset the clock on units the buyer
    // already held - and would silently drop the seller's pre-transfer yield.
    asset.holders[address] = { units: 0, accrued: 0, lots: [] };
  }
  return asset.holders[address];
}

// The simple (non-compounding) yield per unit over a period.
// The simple (non-compounding) yield per unit over a period, unrounded. The
// rounding happens once, on the total, so that a holder's coupon is not
// changed by the number of lots it happens to be split across.
export function rawYieldFor(asset, units, from, to) {
  if (to <= from) return 0;
  const rate = asset.yieldBps / 10000;
  const years = (to - from) / 31536000; // 365 days
  return units * rate * years;
}

// The same yield, rounded to the ledger's precision.
export function yieldFor(asset, units, from, to) {
  return round(rawYieldFor(asset, units, from, to), 8);
}

// SUBSCRIBE: an investor pays the issuer for units of the asset. The units are
// a claim on face value; the money goes into the issuer's reserve.
export function subscribe(state, { investor, assetId, amount, timestamp }) {
  const asset = assetOf(state, assetId);
  const hold = canHold(state, investor, assetId);
  if (!hold.ok) throw new Error(hold.reason);
  if (amount <= 0) throw new Error('subscription amount must be positive');
  const issued = round(asset.issued + amount, 8);
  if (issued > asset.totalSupply) {
    throw new Error(`issue cap reached: ${asset.issued} + ${amount} > ${asset.totalSupply}`);
  }
  const wallet = state.balances[investor] ?? 0;
  if (wallet < amount) throw new Error(`${investor} holds ${wallet} USDC, needs ${amount}`);

  state.balances[investor] = round(wallet - amount, 8);
  asset.issued = issued;
  const holder = holderOf(asset, investor);
  holder.units = round(holder.units + amount, 8);
  holder.lots.push({ units: amount, openedAt: timestamp, accruedTo: timestamp, accrued: 0 });

  post(state.ledger, {
    memo: `subscription ${amount} units of ${assetId}`,
    assetId,
    holder: investor,
    timestamp,
    legs: [
      { account: ACCOUNTS.wallet(investor), credit: amount },
      { account: ACCOUNTS.reserve(assetId), debit: amount },
      { account: ACCOUNTS.position(assetId, investor), debit: amount },
      { account: ACCOUNTS.issued(assetId), credit: amount },
    ],
  });
  return { units: amount, total: holder.units };
}

// ACCRUE: yield builds up on the face value a holder has held. The money is
// set aside in the issuer's reserve as it accrues, so the reserve always
// covers the claims outstanding against it.
export function accrueHolder(state, asset, address, holder, timestamp) {
  let total = 0;
  for (const lot of holder.lots) {
    if (lot.units <= 0) continue;
    const y = rawYieldFor(asset, lot.units, lot.accruedTo, timestamp);
    if (y <= 0) continue;
    lot.accrued = round(lot.accrued + y, 8);
    lot.accruedTo = timestamp;
    total += y; // the total is rounded once, at the end
  }
  if (total <= 0) return 0;
  total = round(total, 8);
  holder.accrued = round(holder.accrued + total, 8);
  post(state.ledger, {
    memo: `yield accrual on ${holder.units} units`,
    assetId: asset.id,
    holder: address,
    timestamp,
    legs: [
      { account: ACCOUNTS.position(asset.id, address), debit: total },
      { account: ACCOUNTS.reserve(asset.id), debit: total },
      { account: ACCOUNTS.yieldObligation(asset.id), credit: total },
      { account: ACCOUNTS.couponIncome(), credit: total },
    ],
  });
  return total;
}

export function accrue(state, { assetId, timestamp }) {
  const asset = assetOf(state, assetId);
  const results = [];
  for (const address of Object.keys(asset.holders)) {
    const holder = asset.holders[address];
    if (holder.units <= 0) continue;
    const y = accrueHolder(state, asset, address, holder, timestamp);
    if (y <= 0) continue;
    results.push({ address, accrued: y, total: holder.accrued });
  }
  return results;
}

// TRANSFER: a holder sells units to another holder at the feed's net asset
// value. Both sides have to pass the compliance gate, and the seller signs
// the transfer - a signature cannot be replayed into another transfer because
// it covers the asset, the units, the price and the timestamp.
export function transfer(state, { from, to, assetId, units, timestamp, signature }) {
  const asset = assetOf(state, assetId);
  if (units <= 0) throw new Error('transfer units must be positive');
  const fromHold = canHold(state, from, assetId);
  if (!fromHold.ok) throw new Error(fromHold.reason);
  const toHold = canHold(state, to, assetId);
  if (!toHold.ok) throw new Error(toHold.reason);
  const seller = holderOf(asset, from);
  if (seller.units < units) throw new Error(`${from} holds ${seller.units} units, cannot sell ${units}`);
  const price = round(units * asset.nav, 8);
  const buyerWallet = state.balances[to] ?? 0;
  if (buyerWallet < price) throw new Error(`${to} holds ${buyerWallet} USDC, needs ${price}`);

  // The signed payload carries a per-seller nonce, and every payload that has
  // been executed is remembered: a signature is good for exactly one transfer.
  const nonce = state.nonces[from] ?? 0;
  const expected = transferPayload({ from, to, assetId, units, price, timestamp, nonce });
  const payloadHash = hash(expected);
  if (state.spentPayloads[payloadHash]) {
    throw new Error(`this signed transfer from ${from} has already been executed`);
  }
  if (!verifySignature(state, from, expected, signature)) {
    // It may not be a forgery: it may be a signature that was already used.
    // Say so, because "replay refused" and "bad signature" are different
    // events for the person reading the log.
    for (const spent of Object.values(state.spentPayloads)) {
      if (verifySignature(state, from, spent.payload, signature)) {
        throw new Error(`this signed transfer from ${from} has already been executed - replay refused`);
      }
    }
    throw new Error(`bad signature from ${from}`);
  }

  // The seller's coupon is settled up to the transfer time, on the units the
  // seller actually held - otherwise the pre-transfer yield is dropped.
  accrueHolder(state, asset, from, seller, timestamp);

  // FIFO: the oldest lots leave first, and each slice becomes a new lot for
  // the buyer with its own clock. The buyer's existing lots are untouched.
  const buyer = holderOf(asset, to);
  const slices = [];
  let remaining = units;
  for (const lot of seller.lots) {
    if (remaining <= 0) break;
    if (lot.units <= 0) continue;
    const take = Math.min(lot.units, remaining);
    lot.units = round(lot.units - take, 8);
    lot.accruedTo = timestamp;
    slices.push({ units: take, openedAt: timestamp, accruedTo: timestamp, accrued: 0 });
    remaining = round(remaining - take, 8);
  }
  seller.units = round(seller.units - units, 8);
  buyer.units = round(buyer.units + units, 8);
  buyer.lots.push(...slices);
  state.nonces[from] = nonce + 1;
  state.spentPayloads[payloadHash] = { payload: expected, timestamp };
  state.balances[from] = round((state.balances[from] ?? 0) + price, 8);
  state.balances[to] = round(buyerWallet - price, 8);

  post(state.ledger, {
    memo: `transfer ${units} units of ${assetId} at ${price} USDC`,
    assetId,
    holder: from,
    timestamp,
    legs: [
      { account: ACCOUNTS.position(assetId, from), credit: units },
      { account: ACCOUNTS.position(assetId, to), debit: units },
      { account: ACCOUNTS.wallet(from), debit: price },
      { account: ACCOUNTS.wallet(to), credit: price },
    ],
  });
  return { units, price, nav: asset.nav };
}

// REDEEM: at maturity a holder cashes out - face value plus the accrued
// yield, less the registry's redemption fee.
export function redeem(state, { holder, assetId, timestamp }) {
  const asset = assetOf(state, assetId);
  if (timestamp < asset.maturity) {
    throw new Error(`${assetId} matures at ${asset.maturity}, not ${timestamp}`);
  }
  const hold = canHold(state, holder, assetId);
  if (!hold.ok) throw new Error(hold.reason);
  const position = holderOf(asset, holder);
  const gross = round(position.units + position.accrued, 8);
  if (gross <= 0) throw new Error(`${holder} holds nothing to redeem`);
  const fee = round((gross * state.params.redemptionFeeBps) / 10000, 8);
  const net = round(gross - fee, 8);

  const face = position.units;
  const accrued = position.accrued;
  state.balances[holder] = round((state.balances[holder] ?? 0) + net, 8);
  position.units = 0;
  position.accrued = 0;
  position.lots = [];
  asset.redeemed = round(asset.redeemed + gross, 8);

  post(state.ledger, {
    memo: `redemption of ${gross} USDC (fee ${fee})`,
    assetId,
    holder,
    timestamp,
    legs: [
      { account: ACCOUNTS.wallet(holder), debit: net },
      { account: ACCOUNTS.fee(assetId), debit: fee },
      { account: ACCOUNTS.reserve(assetId), credit: gross },
      { account: ACCOUNTS.position(assetId, holder), credit: gross },
      { account: ACCOUNTS.issued(assetId), debit: face },
      { account: ACCOUNTS.yieldObligation(assetId), debit: accrued },
    ],
  });
  return { gross, fee, net };
}

// The bytes a seller signs for a transfer.
export function transferPayload({ from, to, assetId, units, price, timestamp, nonce = 0 }) {
  return JSON.stringify({ domain: 'anchor/transfer/v2', from, to, assetId, units, price, timestamp, nonce });
}

function verifySignature(state, address, payload, signature) {
  const key = state.keys[address];
  if (!key) return false;
  try {
    return verify(key, payload, signature);
  } catch {
    return false;
  }
}
