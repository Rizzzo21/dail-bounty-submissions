// The state: parties, wallets (one parent, one or more sandboxes), balances,
// the policy, the held requests and the hash-chained event log.
import { keypair } from './util.js';
import { DEFAULT_POLICY } from './policy.js';

export const PARTY_SEEDS = [
  ['owner', 10000], // the human or agent that owns the parent wallet
  ['agent-nova', 0], // the AI agent that gets a sandbox
  ['vendor-lex', 0], // an allowlisted counterparty
  ['vendor-mia', 0], // an allowlisted counterparty
  ['vendor-zed', 0], // not on the allowlist
  ['scammer-01', 0], // the seeded scam counterparty (a test fixture)
];

export function createParties(seeds = PARTY_SEEDS) {
  const parties = new Map();
  for (const [name, usdc = 0] of seeds) {
    const kp = keypair(`bastion-${name}`);
    parties.set(kp.address, { ...kp, name, usdc });
  }
  return parties;
}

export function createState({ parties, policy } = {}) {
  const cast = parties || createParties();
  const state = {
    policy: structuredClone(policy || DEFAULT_POLICY),
    parties: {},
    partyOrder: [],
    keys: {},
    privateKeys: {},
    balances: {},
    wallets: {},
    walletOrder: [],
    pending: [],
    total: 0,
    events: [],
    eventCount: 0,
    lastHash: '0'.repeat(64),
  };
  for (const holder of cast.values()) {
    state.parties[holder.address] = { address: holder.address, name: holder.name };
    state.partyOrder.push(holder.address);
    state.keys[holder.address] = holder.publicKey;
    state.privateKeys[holder.address] = holder.privateKey;
    state.balances[holder.address] = holder.usdc;
    state.total += holder.usdc;
  }
  return state;
}

export const nameOf = (state, address) => state.parties[address]?.name ?? address;
