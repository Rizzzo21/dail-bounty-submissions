// An attestation: one claim about one agent, in one category, made
// tamper-evident by hashing its own content. The hash is what makes it
// tamper-evident; the provenance check (src/attestations.js) is what makes it
// traceable.
import { hash } from './util.js';

export function makeAttestation({ subject, issuer, category, claim, value, weight = 1, issuedAt, source }) {
  const body = { subject, issuer, category, claim, value, weight, issuedAt, source };
  const digest = hash(body);
  return { id: digest.slice(0, 32), ...body, hash: digest };
}

export function verifyAttestation(attestation, policy) {
  if (!attestation || typeof attestation !== 'object') {
    return { ok: false, reason: 'not an attestation' };
  }
  const { hash: stored, id, ...body } = attestation;
  if (stored !== hash(body)) {
    return { ok: false, reason: 'the attestation hash does not match its content' };
  }
  if (!policy.categories[attestation.category]) {
    return { ok: false, reason: `unknown category "${attestation.category}"` };
  }
  if (!(typeof attestation.value === 'number' && attestation.value >= 0 && attestation.value <= 1)) {
    return { ok: false, reason: 'the value must be a number between 0 and 1' };
  }
  if (attestation.weight <= 0) {
    return { ok: false, reason: 'the weight must be positive' };
  }
  return { ok: true };
}
