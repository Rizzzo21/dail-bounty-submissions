// The registry state: the parties, the assets, the oracle feed and the journal.
import { keypair } from './util.js';
import { createLedger } from './ledger.js';

export const PARAMS = {
  // The redemption fee the registry keeps when a position is cashed out.
  redemptionFeeBps: 25,
  // The feed publishes the net asset value per unit of an asset.
  navDecimals: 6,
  // Year length used for simple (non-compounding) accrual.
  secondsPerYear: 365 * 24 * 3600,
};

// [name, jurisdiction, USDC they start with]
export const PARTY_SEEDS = [
  ['issuer', 'US', 0],
  ['fund-avery', 'US', 500000],
  ['fund-birch', 'TW', 300000],
  ['fund-cobalt', 'SG', 250000],
  ['retail-dana', 'TW', 60000],
  ['retail-eli', 'DE', 20000],
  ['feed', 'US', 0],
];

export function createParties(seeds = PARTY_SEEDS) {
  const parties = new Map();
  for (const [name, jurisdiction, usdc = 0] of seeds) {
    const kp = keypair(`anchor-${name}`);
    parties.set(kp.address, { ...kp, name, jurisdiction, usdc, status: 'UNVERIFIED' });
  }
  return parties;
}

export function createState({ parties } = {}) {
  const cast = parties || createParties();
  const state = {
    params: { ...PARAMS },
    parties: {},
    partyOrder: [],
    keys: {},
    privateKeys: {},
    frozen: {},
    assets: {},
    balances: {},
    ledger: createLedger(),
    events: [],
    eventCount: 0,
    lastHash: '0'.repeat(64),
    feed: null,
    issuer: null,
    // One nonce per seller and the hash of every executed payload: a signed
    // transfer can be executed exactly once.
    nonces: {},
    spentPayloads: {},
  };
  for (const holder of cast.values()) {
    state.parties[holder.address] = {
      address: holder.address,
      name: holder.name,
      jurisdiction: holder.jurisdiction,
      status: holder.status,
      kycAt: null,
    };
    state.partyOrder.push(holder.address);
    state.keys[holder.address] = holder.publicKey;
    state.privateKeys[holder.address] = holder.privateKey;
    state.balances[holder.address] = holder.usdc;
    if (holder.name === 'issuer') state.issuer = holder.address;
    if (holder.name === 'feed') state.feed = holder.address;
  }
  return state;
}

// The asset the demo registers: a US treasury bill that pays 4.5% and matures
// 90 days after it is issued.
export function createAsset(state, { id, name, kind, totalSupply, maturity, yieldBps, issueTimestamp }) {
  state.assets[id] = {
    id,
    name,
    kind,
    totalSupply,
    issued: 0,
    redeemed: 0,
    maturity,
    yieldBps,
    issueTimestamp,
    nav: 1, // net asset value per unit, set by the feed
    navUpdatedAt: issueTimestamp,
    lastAccrual: issueTimestamp,
    holders: {},
  };
  return state.assets[id];
}
