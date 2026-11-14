// The engine: every action is checked, recorded in a hash-chained event log,
// and - for the passport card - signed.
import crypto from 'node:crypto';
import { canonical, hash, sign, verify } from './util.js';
import { categoryScores, compositeScore, evaluateGates } from './score.js';
import { makeAttestation, verifyAttestation } from './attestation.js';
import { fundEscrow, openEscrow, refundEscrow, releaseEscrow } from './escrow.js';
import { byName } from './state.js';

export function emit(state, type, payload) {
  const seq = state.eventCount;
  const body = { seq, type, payload, prevHash: state.lastHash };
  const digest = hash(body);
  const event = { ...body, hash: digest };
  state.eventCount += 1;
  state.events.push(event);
  state.lastHash = digest;
  return event;
}

export function resolveAgent(state, agent) {
  if (typeof agent !== 'string') throw new Error('an agent must be named');
  if (state.agents[agent]) return state.agents[agent];
  const found = byName(state, agent);
  if (!found) throw new Error(`unknown agent "${agent}"`);
  return found;
}

// An attestation only lands on file if its content hash matches AND the claim
// can be traced to a published source record (see src/attestations.js).
export function importAttestation(state, attestation) {
  const check = verifyAttestation(attestation, state.policy);
  if (!check.ok) throw new Error(`the attestation is refused: ${check.reason}`);
  const subject = state.agents[attestation.subject];
  if (!subject) throw new Error('the subject of the attestation is not a registered agent');
  if (state.attestations[attestation.id]) throw new Error('this attestation is already on file');
  state.attestations[attestation.id] = attestation;
  subject.attestations.push(attestation.id);
  emit(state, 'attestation_imported', {
    id: attestation.id,
    subject: attestation.subject,
    category: attestation.category,
    issuer: attestation.issuer,
    source: attestation.source?.recordHash ?? null,
  });
  return attestation;
}

export function attestationsOf(state, agent) {
  const subject = resolveAgent(state, agent);
  return subject.attestations.map((id) => state.attestations[id]);
}

// THE PASSPORT LOOKUP. A vector of category scores, a composite for humans,
// and the gate decision - which never reads the composite.
export function passportOf(state, agent, asOf) {
  const subject = resolveAgent(state, agent);
  const attestations = attestationsOf(state, subject.address);
  const scores = categoryScores(attestations, state.policy, asOf);
  const composite = compositeScore(scores, state.policy);
  const gates = evaluateGates(scores, state.policy);
  return {
    agent: subject.address,
    name: subject.name,
    asOf,
    scores,
    composite,
    gates,
    attestations,
  };
}

export function issueCard(state, { agent, asOf, timestamp }) {
  const passport = passportOf(state, agent, asOf);
  const body = {
    id: hash({ agent: passport.agent, asOf, timestamp }).slice(0, 32),
    agent: passport.agent,
    agentName: passport.name,
    issuer: state.registry,
    policy: state.policy,
    attestations: passport.attestations,
    asOf,
    issuedAt: timestamp,
    scores: passport.scores,
    composite: passport.composite,
    gates: passport.gates,
    prevCardHash: state.cards.length ? state.cards[state.cards.length - 1].hash : '0'.repeat(64),
  };
  const signature = sign(state.privateKeys[state.registry], canonical(body));
  const card = {
    ...body,
    issuerPublicKey: state.keys[state.registry].export({ type: 'spki', format: 'der' }).toString('hex'),
    hash: hash(body),
    signature,
  };
  state.cards.push(card);
  emit(state, 'card_issued', {
    id: card.id,
    agent: card.agent,
    composite: card.composite,
    gatesPass: card.gates.pass,
    failed: card.gates.failed,
  });
  return card;
}

// Standalone verification: anybody can take the card, recompute the scores
// from the attestations inside it, check the signature and the chain link,
// without trusting the issuer's numbers.
export function verifyCard(card, { asOf = card.asOf, policy = card.policy } = {}) {
  const { hash: stored, signature, issuerPublicKey, ...body } = card;
  const contentOk = stored === hash(body);
  let signatureOk = false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(issuerPublicKey, 'hex'), format: 'der', type: 'spki' });
    signatureOk = verify(key, canonical(body), signature);
  } catch {
    signatureOk = false;
  }
  const scores = categoryScores(body.attestations, policy, asOf);
  const composite = compositeScore(scores, policy);
  const gates = evaluateGates(scores, policy);
  const scoresMatch =
    canonical(scores) === canonical(body.scores) &&
    composite === body.composite &&
    canonical(gates) === canonical(body.gates);
  return {
    ok: contentOk && signatureOk && scoresMatch,
    contentOk,
    signatureOk,
    scoresMatch,
    recomputedAt: asOf,
    scores,
    composite,
    gates,
  };
}

export { openEscrow, fundEscrow, releaseEscrow, refundEscrow };
export { makeAttestation };
