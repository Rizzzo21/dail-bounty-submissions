// Builds attestations/claims.json from the shipped source excerpts.
//
// The mapping below says which real record in which published artifact backs
// each claim, and what the claim is worth. The record hashes are computed here
// from the shipped files, so the claims file can always be regenerated and
// checked:  node scripts/build-claims.mjs
//
// This script is deterministic and makes no network calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '../src/util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'attestations');

// The date the attesting registries compiled their attestations.
const ISSUED_AT = 1807776000; // 90 days after the demo epoch

const MAPPING = [
  {
    agent: 'agent-ava', category: 'settlement', value: 0.95,
    claim: 'redeemed a matured T-bill position for 98,839 USDC',
    issuer: 'near-anchor-registry',
    source: { file: 'anchor-events.jsonl', seq: 17, entry: 'bnty_0414', url: 'https://near-anchor.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-ava', category: 'disclosure', value: 0.95,
    claim: 'published every coupon accrual as it happened',
    issuer: 'near-anchor-registry',
    source: { file: 'anchor-events.jsonl', seq: 12, entry: 'bnty_0414', url: 'https://near-anchor.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-ava', category: 'community', value: 0.3,
    claim: 'took a small part in a HOWL window that burned 1% of every trade',
    issuer: 'near-ritual-registry',
    source: { file: 'ritual-scenarios.json', name: 'howl', entry: 'bnty_0421', url: 'https://near-ritual.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-ava', category: 'privacy', value: 0.9,
    claim: 'refused to serve a party that had not cleared its compliance gate',
    issuer: 'near-anchor-registry',
    source: { file: 'anchor-events.jsonl', seq: 5, entry: 'bnty_0414', url: 'https://near-anchor.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-bob', category: 'settlement', value: 0.9,
    claim: 'settled a secondary trade of 2,000 units at the published NAV',
    issuer: 'near-anchor-registry',
    source: { file: 'anchor-events.jsonl', seq: 10, entry: 'bnty_0414', url: 'https://near-anchor.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-bob', category: 'disclosure', value: 0.95,
    claim: 'published a net asset value the market could price against',
    issuer: 'near-anchor-registry',
    source: { file: 'anchor-events.jsonl', seq: 9, entry: 'bnty_0414', url: 'https://near-anchor.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-bob', category: 'community', value: 0.9,
    claim: 'led a CHANT that minted supply into the treasury floor',
    issuer: 'near-ritual-registry',
    source: { file: 'ritual-scenarios.json', name: 'chant', entry: 'bnty_0421', url: 'https://near-ritual.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-bob', category: 'privacy', value: 0.85,
    claim: 'refused a redemption while a counterparty was under review',
    issuer: 'near-anchor-registry',
    source: { file: 'anchor-events.jsonl', seq: 16, entry: 'bnty_0414', url: 'https://near-anchor.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-cid', category: 'settlement', value: 0.85,
    claim: 'subscribed 100,000 USDC of a T-bill and held it',
    issuer: 'near-anchor-registry',
    source: { file: 'anchor-events.jsonl', seq: 6, entry: 'bnty_0414', url: 'https://near-anchor.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-cid', category: 'disclosure', value: 0.7,
    claim: 'published its subscription and its share of the issue',
    issuer: 'near-anchor-registry',
    source: { file: 'anchor-events.jsonl', seq: 8, entry: 'bnty_0414', url: 'https://near-anchor.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-cid', category: 'community', value: 0.45,
    claim: 'parted with tokens in a HOWL window, well below the quorum',
    issuer: 'near-ritual-registry',
    source: { file: 'ritual-scenarios.json', name: 'howl', entry: 'bnty_0421', url: 'https://near-ritual.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-cid', category: 'privacy', value: 0.75,
    claim: 'froze a counterparty under sanctions review',
    issuer: 'near-anchor-registry',
    source: { file: 'anchor-events.jsonl', seq: 15, entry: 'bnty_0414', url: 'https://near-anchor.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-dan', category: 'settlement', value: 0.4,
    claim: 'was frozen mid-obligation and did not complete it',
    issuer: 'near-anchor-registry',
    source: { file: 'anchor-events.jsonl', seq: 15, entry: 'bnty_0414', url: 'https://near-anchor.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-dan', category: 'disclosure', value: 0.6,
    claim: 'published the refusal to act on a ritual that missed quorum',
    issuer: 'near-ritual-registry',
    source: { file: 'ritual-scenarios.json', name: 'quorum', entry: 'bnty_0421', url: 'https://near-ritual.surge.sh/docs/demo-trace.json' },
  },
  {
    agent: 'agent-dan', category: 'privacy', value: 0.8,
    claim: 'kept its own settlement hidden until the review closed',
    issuer: 'near-anchor-registry',
    source: { file: 'anchor-events.jsonl', seq: 16, entry: 'bnty_0414', url: 'https://near-anchor.surge.sh/docs/demo-trace.json' },
  },
];

function loadRecords(file) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  if (file.endsWith('.jsonl')) {
    return text.split('\n').filter((l) => l.trim()).map((line) => {
      const record = JSON.parse(line);
      return { record, hash: hash(record) };
    });
  }
  const parsed = JSON.parse(text);
  return (parsed.scenarios ?? []).map((record) => ({ record, hash: hash(record) }));
}

const records = {
  'anchor-events.jsonl': loadRecords('anchor-events.jsonl'),
  'ritual-scenarios.json': loadRecords('ritual-scenarios.json'),
};

const claims = [];
const problems = [];
for (const entry of MAPPING) {
  const pool = records[entry.source.file];
  let found = null;
  if (entry.source.seq !== undefined) {
    found = pool.find((item) => item.record.seq === entry.source.seq);
  } else if (entry.source.name !== undefined) {
    found = pool.find((item) => item.record.name === entry.source.name);
  }
  if (!found) {
    problems.push(`no source record for ${entry.agent}/${entry.category} in ${entry.source.file}`);
    continue;
  }
  claims.push({
    agent: entry.agent,
    category: entry.category,
    value: entry.value,
    weight: entry.weight ?? 1,
    claim: entry.claim,
    issuer: entry.issuer,
    issuedAt: ISSUED_AT,
    source: {
      file: entry.source.file,
      recordHash: found.hash,
      entry: entry.source.entry,
      url: entry.source.url,
    },
  });
}

if (problems.length > 0) {
  console.error('REFUSED:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const out = {
  note: 'Each claim points at a real record shipped in attestations/. The passport re-hashes the record and refuses a claim it cannot trace.',
  compiledAt: ISSUED_AT,
  claims,
};
fs.writeFileSync(path.join(dir, 'claims.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote attestations/claims.json - ${claims.length} claims`);
