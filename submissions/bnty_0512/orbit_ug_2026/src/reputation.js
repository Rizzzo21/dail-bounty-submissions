// Portable agent reputation passport.
//
// A passport is an append-only, hash-linked log of a single agent's market history:
// jobs it won, escrow it was paid through, defaults, collective purchases. The
// passport is *portable*: it is a plain JSON document that any chain can verify
// without trusting the issuer's database, because every event carries the hash of
// its predecessor and the head is signed by the issuer.
import { canonical, digestOf, keypairFromSeed, sha256, signWith, verifyWith } from './util.js';

export const PASSPORT_BASE_SCORE = 50;

/** Score delta contributed by one event. Kept tiny and explicit on purpose. */
export function scoreDelta(event) {
  switch (event.type) {
    case 'job_settled':
      return Math.round(10 * (event.data.quality - 0.5));
    case 'job_defaulted':
      return -20;
    case 'collective_purchase':
      return 2;
    case 'private_round':
      return 1;
    case 'job_awarded':
    case 'bid_placed':
    case 'gate_blocked':
      return 0;
    default:
      return 0;
  }
}

export class ReputationPassport {
  constructor({ agentId, issuer = 'dail-house', events = [], signature = null } = {}) {
    this.agentId = agentId;
    this.issuer = issuer;
    this.events = events;
    this.signature = signature;
  }

  static idFor(agentId, issuer = 'dail-house') {
    return `passport:${sha256(canonical({ agentId, issuer })).slice(0, 32)}`;
  }

  get id() {
    return ReputationPassport.idFor(this.agentId, this.issuer);
  }

  get head() {
    return this.events.length ? this.events[this.events.length - 1].hash : 'genesis';
  }

  /** Append an event, linking it to the previous hash. Returns the new event. */
  append(type, data = {}, round = null) {
    const event = {
      index: this.events.length,
      type,
      round,
      data,
      prev: this.head,
    };
    event.hash = digestOf({ ...event, hash: undefined });
    this.events.push(event);
    return event;
  }

  /** Reputation score in [0, 100]. */
  get score() {
    let score = PASSPORT_BASE_SCORE;
    for (const event of this.events) score += scoreDelta(event);
    return Math.max(0, Math.min(100, score));
  }

  /** Escrow-linked history: everything the agent touched in the money rail. */
  escrowHistory() {
    return this.events.filter((e) =>
      ['job_awarded', 'job_settled', 'job_defaulted', 'collective_purchase', 'shielded_settled'].includes(
        e.type,
      ),
    );
  }

  toJSON() {
    return {
      id: this.id,
      agentId: this.agentId,
      issuer: this.issuer,
      score: this.score,
      head: this.head,
      signature: this.signature,
      events: this.events,
    };
  }

  /** Sign the head hash with the issuer key (portable proof of provenance). */
  sign(issuerKeypair) {
    this.signature = signWith(issuerKeypair.priv, this.head).toString('hex');
    return this.signature;
  }

  verifySignature(issuerPublicKeyRaw) {
    if (!this.signature) return false;
    return verifyWith(issuerPublicKeyRaw, this.head, this.signature);
  }

  /** Verify the hash chain of an imported document. Returns { valid, reason }. */
  static verifyChain(doc) {
    let prev = 'genesis';
    for (const event of doc.events || []) {
      const expected = digestOf({ ...event, hash: undefined });
      if (event.prev !== prev) return { valid: false, reason: `broken link at index ${event.index}` };
      if (event.hash !== expected) return { valid: false, reason: `bad hash at index ${event.index}` };
      prev = event.hash;
    }
    return { valid: true, reason: 'ok' };
  }

  static fromJSON(doc) {
    return new ReputationPassport({
      agentId: doc.agentId,
      issuer: doc.issuer,
      events: doc.events || [],
      signature: doc.signature || null,
    });
  }
}

/** Deterministic issuer keypair used by the demo + the house in production. */
export function issuerKeypair(seed = 'dail-house-issuer') {
  return keypairFromSeed(sha256(seed));
}
