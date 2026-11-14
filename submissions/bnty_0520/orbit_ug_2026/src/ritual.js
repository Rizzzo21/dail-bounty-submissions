// Rituals: the community actions that make the token do something.
// A ritual is a signed, quorum-gated action. Signatures cover the rule set, so
// a signer cannot be replayed into a ritual with different parameters.
import { canonical, hash, round, verify } from './util.js';

export const KINDS = ['CHANT', 'BURN', 'HOWL'];

// One vote per signer, and a whale's vote counts the same as anyone's: the
// weight is the square root of the stake, capped at 1.
export function voteWeight(balance) {
  return Math.min(Math.sqrt(Math.max(balance, 0)) / 100, 1);
}

export function ritualIdFor(state, kind, epoch, addresses) {
  const pending = state.rituals.find((r) => r.kind === kind && r.epoch === epoch && r.status === 'pending');
  if (pending) return pending.id;
  const key = hash({ kind, epoch, addresses: [...addresses].sort() });
  return `rit_${epoch}_${kind}_${key.slice(0, 8)}`;
}

// The exact bytes a signer signs.
export function ritualPayload({ kind, epoch, ritualId, address, paramsHash }) {
  return canonical({ domain: 'ritual/v1', kind, epoch, ritualId, address, paramsHash });
}

export function paramsHash(state) {
  return hash(state.params);
}

// Check one signer against the rules. Returns { ok, reason }.
export function checkSigner(state, keys, { address, sig, kind, epoch, ritualId }) {
  const key = keys[address];
  if (!key) return { ok: false, reason: `unknown signer ${address}` };
  const held = state.balances[address] ?? 0;
  if (held < state.params.minStake) {
    return { ok: false, reason: `${address} holds ${held} tokens, below minStake ${state.params.minStake}` };
  }
  const votes = state.votesThisEpoch[epoch] ?? [];
  if (votes.includes(address)) {
    return { ok: false, reason: `${address} already voted in epoch ${epoch}` };
  }
  const payload = ritualPayload({ kind, epoch, ritualId, address, paramsHash: paramsHash(state) });
  if (!verify(key, payload, sig)) return { ok: false, reason: `bad signature from ${address}` };
  return { ok: true, weight: round(voteWeight(held), 4), stake: held };
}
