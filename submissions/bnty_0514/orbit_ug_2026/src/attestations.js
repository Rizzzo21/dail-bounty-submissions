// Loading the claims and checking their provenance.
//
// A claim is only worth carrying if it can be traced to a published record.
// The two records this passport reads are real artifacts of the author's own
// earlier NEAR entries (bnty_0421 RITUAL and bnty_0414 ANCHOR), shipped here
// verbatim as excerpts. The passport does not trust them - it re-hashes each
// record and refuses a claim whose source hash is not in the excerpt.
import fs from 'node:fs';
import path from 'node:path';
import { hash } from './util.js';
import { makeAttestation } from './attestation.js';

export function loadSourceRecords(dir, file) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  if (file.endsWith('.jsonl')) {
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const record = JSON.parse(line);
        return { file, record, hash: hash(record) };
      });
  }
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed.scenarios ?? [];
  return list.map((record) => ({ file, record, hash: hash(record) }));
}

export function loadClaims(dir) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'claims.json'), 'utf8'));
  return raw.claims ?? [];
}

// The provenance check: the claimed source record has to exist in the shipped
// excerpt, byte for byte, under the hash the claim names.
export function verifyProvenance(claim, sources) {
  const file = claim.source.file;
  const inFile = sources.filter((entry) => entry.file === file);
  // Re-hash the record rather than trusting the hash stored beside it: a
  // tampered excerpt cannot keep the provenance of the claim that cites it.
  const found = inFile.find((entry) => hash(entry.record) === claim.source.recordHash);
  if (!found) {
    return {
      ok: false,
      reason: `no record with hash ${String(claim.source.recordHash).slice(0, 12)}... in ${file}`,
    };
  }
  return { ok: true, record: found.record };
}

// Build the attestations for a set of agents. Every one of them must survive
// the provenance check, or the passport refuses the whole batch.
export function buildAttestations(dir, { agents, asOf, issuedAt }) {
  const claims = loadClaims(dir);
  const sources = [
    ...loadSourceRecords(dir, 'anchor-events.jsonl'),
    ...loadSourceRecords(dir, 'ritual-scenarios.json'),
  ];
  const attestations = [];
  const refusals = [];
  for (const claim of claims) {
    const subject = agents[claim.agent];
    if (!subject) {
      refusals.push({ claim, reason: `unknown agent "${claim.agent}"` });
      continue;
    }
    const provenance = verifyProvenance(claim, sources);
    if (!provenance.ok) {
      refusals.push({ claim, reason: `untraceable claim: ${provenance.reason}` });
      continue;
    }
    const attestation = makeAttestation({
      subject: subject.address,
      issuer: claim.issuer,
      category: claim.category,
      claim: claim.claim,
      value: claim.value,
      weight: claim.weight ?? 1,
      issuedAt: claim.issuedAt ?? issuedAt,
      source: {
        file: claim.source.file,
        recordHash: claim.source.recordHash,
        entry: claim.source.entry ?? null,
        url: claim.source.url ?? null,
      },
    });
    attestations.push(attestation);
  }
  return { attestations, refusals, claims, sources };
}
