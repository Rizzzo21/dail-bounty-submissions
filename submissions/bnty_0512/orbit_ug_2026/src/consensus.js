// Leaderless consensus.
//
// Nobody is the leader. Each validator independently re-derives the market outcome
// from chain state, computes a digest of it, and signs a vote for that digest.
// A digest is COMMITTED once a supermajority (>2/3) of validators have signed the
// same digest. Votes are Ed25519-signed and verified, so a validator cannot vote
// for someone else's claim.
//
// If the first round produces no quorum (e.g. validators disagree because one of
// them saw a different bid set), the round escalates: validators re-derive from
// the canonical state at a higher round number and vote again, with the previous
// round's non-committed votes carried forward as evidence.
import { digestOf, verifyWith } from './util.js';

export const quorumSize = (validators) => Math.floor((2 * validators) / 3) + 1;

export const proposalDigest = (payload) => digestOf(payload);

export class ConsensusRound {
  constructor({ round = 1, validators = [], payload = null, previous = null } = {}) {
    this.round = round;
    this.validators = [...validators].sort();
    this.payload = payload;
    this.previous = previous;
    this.votes = new Map(); // agent_id -> { digest, signature, round }
    this.committed = false;
    this.commitDigest = null;
    this.quorum = quorumSize(this.validators.length);
  }

  /** Record a signed vote; invalid signatures are rejected. */
  cast(vote, publicKeyOf) {
    const { agent_id, digest, signature, round = this.round } = vote;
    if (!this.validators.includes(agent_id)) {
      return { ok: false, error: `not a validator: ${agent_id}` };
    }
    if (round !== this.round) {
      return { ok: false, error: `round mismatch: ${round} != ${this.round}` };
    }
    const pk = publicKeyOf(agent_id);
    if (!pk) return { ok: false, error: `no public key for ${agent_id}` };
    if (!verifyWith(pk, digest, signature)) {
      return { ok: false, error: `invalid signature from ${agent_id}` };
    }
    if (this.votes.has(agent_id)) {
      return { ok: false, error: `validator ${agent_id} already voted` };
    }
    this.votes.set(agent_id, { agent_id, digest, signature, round });
    return { ok: true };
  }

  /** Count votes and commit if a supermajority agrees on one digest. */
  tally() {
    const counts = new Map();
    for (const vote of this.votes.values()) {
      counts.set(vote.digest, (counts.get(vote.digest) || 0) + 1);
    }
    let best = null;
    for (const [digest, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      if (!best || count > best.count) best = { digest, count };
    }
    const votesFor = best ? best.count : 0;
    const votesAgainst = this.votes.size - votesFor;
    if (best && votesFor >= this.quorum) {
      this.committed = true;
      this.commitDigest = best.digest;
    }
    return {
      committed: this.committed,
      digest: this.commitDigest,
      votes_for: votesFor,
      votes_against: votesAgainst,
      quorum: this.quorum,
      validators: this.validators.length,
    };
  }

  /** Next round if this one failed to reach quorum. */
  escalate(payload) {
    return new ConsensusRound({
      round: this.round + 1,
      validators: this.validators,
      payload,
      previous: this,
    });
  }
}
