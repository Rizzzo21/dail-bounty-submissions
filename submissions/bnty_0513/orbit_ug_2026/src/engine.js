// The registry engine. Every action is checked, every action that changes
// anything appends a hash-chained event, and the whole registry replays
// identically from the same inputs.
import { hash, round, sign } from './util.js';
import { post } from './ledger.js';
import { STATUS } from './compliance.js';
import { ACCOUNTS, accrue, assetOf, holderOf, redeem, subscribe, transfer, transferPayload } from './asset.js';

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

export function stateFingerprint(state) {
  return hash({
    assets: state.assets,
    balances: state.balances,
    parties: state.parties,
    ledger: state.ledger,
  });
}

function requireAdmin(state, who, what) {
  if (who !== state.issuer) throw new Error(`only the registry (issuer) may ${what}`);
}

function requireFeed(state, who) {
  if (who !== state.feed) throw new Error('only the price feed may publish a net asset value');
}

// REGISTER: the registry issues an asset into the registry.
export function registerAsset(state, { admin, id, name, kind, totalSupply, maturity, yieldBps, timestamp }) {
  requireAdmin(state, admin, 'register an asset');
  if (state.assets[id]) throw new Error(`${id} is already registered`);
  const asset = {
    id,
    name,
    kind,
    totalSupply,
    issued: 0,
    redeemed: 0,
    maturity,
    yieldBps,
    issueTimestamp: timestamp,
    nav: 1,
    navUpdatedAt: timestamp,
    holders: {},
  };
  state.assets[id] = asset;
  emit(state, 'asset_registered', {
    id,
    name,
    kind,
    totalSupply,
    maturity,
    yieldBps,
    nav: asset.nav,
  });
  return asset;
}

// CLEAR: the registry clears a party to hold assets (or blocks it).
export function clearParty(state, { admin, address, status, jurisdiction, timestamp }) {
  requireAdmin(state, admin, 'clear a party');
  const party = state.parties[address];
  if (!party) throw new Error(`unknown party ${address}`);
  party.status = status;
  if (jurisdiction) party.jurisdiction = jurisdiction;
  party.kycAt = timestamp;
  emit(state, 'party_cleared', { address, status, jurisdiction: party.jurisdiction });
  return party;
}

export function freezeParty(state, { admin, address, frozen, reason }) {
  requireAdmin(state, admin, 'freeze a party');
  state.frozen[address] = Boolean(frozen);
  emit(state, 'party_frozen', { address, frozen: Boolean(frozen), reason });
  return state.frozen[address];
}

export function setFeed(state, { admin, address }) {
  requireAdmin(state, admin, 'appoint a price feed');
  state.feed = address;
  emit(state, 'feed_appointed', { address });
  return address;
}

// NAV: the feed publishes the net asset value of one unit.
export function publishNav(state, { feed, assetId, nav, timestamp }) {
  requireFeed(state, feed);
  const asset = assetOf(state, assetId);
  if (!(nav > 0)) throw new Error('net asset value must be positive');
  asset.nav = nav;
  asset.navUpdatedAt = timestamp;
  emit(state, 'nav_published', { assetId, nav, timestamp });
  return nav;
}

export function subscribeAction(state, { investor, assetId, amount, timestamp }) {
  try {
    const result = subscribe(state, { investor, assetId, amount, timestamp });
    emit(state, 'subscribed', { investor, assetId, amount, units: result.total, issued: assetOf(state, assetId).issued });
    return result;
  } catch (error) {
    emit(state, 'action_rejected', { action: 'subscribe', investor, assetId, reason: error.message });
    throw error;
  }
}

export function accrueAction(state, { assetId, timestamp }) {
  const results = accrue(state, { assetId, timestamp });
  for (const r of results) {
    emit(state, 'yield_accrued', { assetId, address: r.address, accrued: r.accrued, total: r.total });
  }
  return results;
}

export function transferAction(state, { from, to, assetId, units, timestamp, signature }) {
  try {
    const result = transfer(state, { from, to, assetId, units, timestamp, signature });
    emit(state, 'transferred', { from, to, assetId, units, price: result.price, nav: result.nav });
    return result;
  } catch (error) {
    emit(state, 'action_rejected', { action: 'transfer', from, to, assetId, reason: error.message });
    throw error;
  }
}

export function redeemAction(state, { holder, assetId, timestamp }) {
  try {
    const result = redeem(state, { holder, assetId, timestamp });
    emit(state, 'redeemed', { holder, assetId, ...result });
    return result;
  } catch (error) {
    emit(state, 'action_rejected', { action: 'redeem', holder, assetId, reason: error.message });
    throw error;
  }
}

// The coverage rule: the issuer's cash must always cover the claims that are
// outstanding against it. This is the invariant the tests police.
export function coverage(state, assetId) {
  const asset = assetOf(state, assetId);
  let claims = 0;
  for (const holder of Object.values(asset.holders)) {
    claims = round(claims + holder.units + holder.accrued, 8);
  }
  const reserve = state.ledger.accounts[ACCOUNTS.reserve(assetId)] || 0;
  return { reserve: round(reserve, 8), claims: round(claims, 8), covered: reserve + 1e-6 >= claims };
}

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

// Sign a transfer (the seller's side).
export function signTransfer(state, from, { to, assetId, units, timestamp }) {
  const asset = assetOf(state, assetId);
  const price = round(units * asset.nav, 8);
  const nonce = state.nonces[from] ?? 0;
  const payload = transferPayload({ from, to, assetId, units, price, timestamp, nonce });
  const privateKey = state.privateKeys[from];
  return sign(privateKey, payload);
}
