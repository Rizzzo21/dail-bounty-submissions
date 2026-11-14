// The passport registry: the agents, the scoring policy, the attestations,
// the escrows and the issued passport cards.
import { keypair } from './util.js';

export const CATEGORIES = ['settlement', 'disclosure', 'community', 'privacy'];

// The scoring policy. It travels with every passport card, so any verifier can
// recompute the score instead of trusting the issuer's number.
export const DEFAULT_POLICY = {
  // How fast an attestation loses weight. 90 days: a claim worth 100 points
  // today is worth 50 points in 90 days.
  halflifeDays: 90,
  categories: {
    settlement: { weight: 1.0, minimum: 70, label: 'delivers what it promises' },
    disclosure: { weight: 0.8, minimum: 60, label: 'shows its work' },
    community: { weight: 0.6, minimum: 50, label: 'supports the commons' },
    privacy: { weight: 0.9, minimum: 65, label: 'protects the people it deals with' },
  },
};

export const PARTY_SEEDS = [
  ['registry', 0],
  ['agent-ava', 1000],
  ['agent-bob', 1000],
  ['agent-cid', 1000],
  ['agent-dan', 1000],
  ['client-echo', 1000],
];

export function createParties(seeds = PARTY_SEEDS) {
  const parties = new Map();
  for (const [name, credits = 0] of seeds) {
    const kp = keypair(`passport-${name}`);
    parties.set(kp.address, { ...kp, name, credits });
  }
  return parties;
}

export function createState({ parties } = {}) {
  const cast = parties || createParties();
  const state = {
    policy: structuredClone(DEFAULT_POLICY),
    agents: {},
    agentOrder: [],
    keys: {},
    privateKeys: {},
    attestations: {},
    escrows: {},
    escrowOrder: [],
    cards: [],
    events: [],
    eventCount: 0,
    lastHash: '0'.repeat(64),
    registry: null,
  };
  for (const holder of cast.values()) {
    state.agents[holder.address] = {
      address: holder.address,
      name: holder.name,
      credits: holder.credits,
      attestations: [],
      escrows: [],
    };
    state.agentOrder.push(holder.address);
    state.keys[holder.address] = holder.publicKey;
    state.privateKeys[holder.address] = holder.privateKey;
    if (holder.name === 'registry') state.registry = holder.address;
  }
  return state;
}

export const byName = (state, name) =>
  state.agentOrder.map((address) => state.agents[address]).find((agent) => agent.name === name);
