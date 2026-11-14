// The protocol's tunables and the initial state. Every number the rules use lives
// in `params`, so a reader (or the house) can see the whole rule set in one place.
import { keypair } from './util.js';

export const DEFAULT_PARAMS = {
  // A ritual fires when the weighted votes of its signers reach `quorumVotes`.
  quorumVotes: 3,
  // Only an address holding at least this many tokens may sign a ritual
  // (proof of skin in the game - the anti-Sybil rule).
  minStake: 1000,
  // CHANT: tokens each signer pays into the treasury when the ritual fires.
  chantFee: 100,
  // BURN: tokens each signer burns when the ritual fires.
  burnPerSigner: 5000,
  // CHANT: the most a single ritual can mint, before the participation factor.
  mintCap: 500_000,
  // Share of every mint that goes to the steward (disclosed, not hidden).
  stewardBps: 200,
  // Share of accrued pool fees burned at settlement.
  feeBurnBps: 3000,
  // Treasury rule 1 (liquidity floor): the treasury mints itself tokens up to
  // this floor, so it always holds a float of the token it governs.
  treasuryFloor: 10000,
  // Treasury rule 2 (buyback): above this USDC ceiling the treasury buys
  // tokens with its fees and burns them.
  treasuryCeiling: 10000,
  // AMM swap fee.
  poolFeeBps: 300,
  // HOWL: extra burn applied to fees while a howl window is open.
  howlTaxBps: 100,
  burnAddress: 'acc_burn_000000000000',
  stewardAddress: 'acc_steward_0000000000',
};

// The starting pool: 2,000,000 tokens against 800,000 USDC.
export const DEFAULT_POOL = { x: 2_000_000, y: 800_000 };

// The demo cast. Seeds are fixed strings, so every address is reproducible.
// [name, tokens, USDC]
export const CAST = [
  ['mara', 250000, 120000],
  ['ivo', 180000, 90000],
  ['sana', 140000, 75000],
  ['tomas', 120000, 60000],
  ['wren', 90000, 400000],
  ['kofi', 60000, 30000],
  ['lin', 40000, 20000],
  ['orca', 25000, 12000],
  ['whale', 5000000, 5000000],
  ['steward', 0, 0],
];

export function createCast(entries = CAST) {
  const cast = new Map();
  for (const [name, balance, usdc = 0] of entries) {
    const kp = keypair(`ritual-${name}`);
    cast.set(kp.address, { ...kp, name, balance, usdc });
  }
  return cast;
}

export function createState({ cast, pool = DEFAULT_POOL, params = {}, epoch = 1 } = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const balances = {};
  const usdc = {};
  for (const holder of cast.values()) {
    balances[holder.address] = holder.balance;
    usdc[holder.address] = holder.usdc;
  }
  const supply = Object.values(balances).reduce((a, b) => a + b, 0) + pool.x;
  return {
    epoch,
    params: p,
    supply,
    balances,
    usdc,
    // The treasury holds two assets: USDC collected as trading fees, and
    // tokens collected as ritual fees plus whatever the liquidity floor minted.
    treasury: {
      tokens: 0,
      usdc: 0,
      fees: 0,
      ritualFees: 0,
      mintedForFloor: 0,
      boughtBackBurned: 0,
    },
    pool: { x: pool.x, y: pool.y, feeBps: p.poolFeeBps },
    steward: p.stewardAddress,
    burnAddress: p.burnAddress,
    rituals: [],
    events: [],
    votesThisEpoch: {},
    // 0 = no howl window is open. It opens only when a HOWL ritual fires.
    howlUntilEpoch: 0,
    lastHash: '0'.repeat(64),
    eventCount: 0,
  };
}
