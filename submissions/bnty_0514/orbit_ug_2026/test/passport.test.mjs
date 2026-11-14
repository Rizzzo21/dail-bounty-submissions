// The test suite. `npm test` runs it with the Node standard test runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAttestations,
  loadSourceRecords,
  verifyProvenance,
} from '../src/attestations.js';
import { makeAttestation, verifyAttestation } from '../src/attestation.js';
import { categoryScores, compositeScore, evaluateGates } from '../src/score.js';
import {
  emit,
  fundEscrow,
  importAttestation,
  issueCard,
  openEscrow,
  passportOf,
  releaseEscrow,
  refundEscrow,
  resolveAgent,
  verifyCard,
} from '../src/engine.js';
import { escrowHistory } from '../src/escrow.js';
import { createParties, createState } from '../src/state.js';
import { hash, keypair } from '../src/util.js';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'attestations');

const T0 = 1800000000;
const DAY = 86400;
const ASOF = T0 + 97 * DAY;
const COMPILED_AT = T0 + 90 * DAY;

function setup() {
  const parties = createParties();
  const state = createState({ parties });
  const agents = {};
  for (const holder of parties.values()) agents[holder.name] = holder;
  const { attestations, refusals } = buildAttestations(dir, { agents, asOf: ASOF, issuedAt: COMPILED_AT });
  for (const attestation of attestations) importAttestation(state, attestation);
  return { state, agents, refusals, attestations };
}

test('a seed always produces the same address', () => {
  assert.equal(keypair('passport-agent-ava').address, keypair('passport-agent-ava').address);
  assert.notEqual(keypair('passport-agent-ava').address, keypair('passport-agent-bob').address);
});

test('every claim traces to a record in a shipped source file', () => {
  const { refusals, attestations } = setup();
  assert.equal(refusals.length, 0);
  assert.equal(attestations.length, 15);
  for (const attestation of attestations) {
    assert.ok(attestation.source.recordHash.length === 64);
    assert.ok(attestation.source.url.startsWith('https://'));
  }
});

test('a claim whose source hash is not in the excerpt is refused', () => {
  const sources = loadSourceRecords(dir, 'anchor-events.jsonl');
  const claim = { source: { file: 'anchor-events.jsonl', recordHash: 'f'.repeat(64) } };
  const result = verifyProvenance(claim, sources);
  assert.equal(result.ok, false);
  assert.match(result.reason, /no record with hash/);
});

test('a tampered source record breaks the provenance of its claim', () => {
  const sources = loadSourceRecords(dir, 'anchor-events.jsonl');
  const claim = { source: { file: 'anchor-events.jsonl', recordHash: sources[0].hash } };
  assert.equal(verifyProvenance(claim, sources).ok, true);
  const tampered = { ...sources[0], record: { ...sources[0].record, payload: { hacked: true } } };
  const pool = [tampered];
  assert.equal(verifyProvenance(claim, pool).ok, false);
});

test('an attestation whose content was changed is refused', () => {
  const attestation = makeAttestation({
    subject: 'acc_x',
    issuer: 'near-anchor-registry',
    category: 'settlement',
    claim: 'did a thing',
    value: 0.9,
    issuedAt: COMPILED_AT,
    source: null,
  });
  const state = createState();
  assert.equal(verifyAttestation(attestation, state.policy).ok, true);
  const tampered = { ...attestation, value: 1 };
  assert.equal(verifyAttestation(tampered, state.policy).ok, false);
});

test('an attestation in an unknown category is refused', () => {
  const state = createState();
  const attestation = makeAttestation({
    subject: 'acc_x',
    issuer: 'x',
    category: 'charisma',
    claim: 'was charming',
    value: 1,
    issuedAt: COMPILED_AT,
    source: null,
  });
  const check = verifyAttestation(attestation, state.policy);
  assert.equal(check.ok, false);
  assert.match(check.reason, /unknown category/);
});

test('the passport is a vector of category scores, not one number', () => {
  const { state } = setup();
  const passport = passportOf(state, 'agent-ava', ASOF);
  assert.deepEqual(Object.keys(passport.scores).sort(), ['community', 'disclosure', 'privacy', 'settlement']);
  assert.equal(typeof passport.composite, 'number');
  assert.equal(passport.scores.community.count, 1);
});

test('a strong composite does not open a gate a weak category fails', () => {
  const { state } = setup();
  const passport = passportOf(state, 'agent-ava', ASOF);
  assert.ok(passport.composite > 70, `composite should look good, got ${passport.composite}`);
  assert.equal(passport.gates.pass, false);
  assert.deepEqual(passport.gates.failed, ['community']);
});

test('the gates are a conjunction over categories', () => {
  const { state } = setup();
  const good = passportOf(state, 'agent-bob', ASOF);
  assert.equal(good.gates.pass, true);
  assert.equal(good.gates.failed.length, 0);
  const bad = passportOf(state, 'agent-dan', ASOF);
  assert.equal(bad.gates.pass, false);
  assert.ok(bad.gates.failed.length >= 2);
});

test('a score falls as the attestations age', () => {
  const { state } = setup();
  const now = passportOf(state, 'agent-bob', ASOF);
  const later = passportOf(state, 'agent-bob', ASOF + 180 * DAY);
  assert.ok(later.scores.settlement.score < now.scores.settlement.score);
  assert.ok(later.composite < now.composite);
});

test('the score is recomputed from the attestations, never stored', () => {
  const { state } = setup();
  const passport = passportOf(state, 'agent-bob', ASOF);
  const attestations = passport.attestations;
  const fresh = categoryScores(attestations, state.policy, ASOF);
  assert.equal(compositeScore(fresh, state.policy), passport.composite);
  assert.deepEqual(evaluateGates(fresh, state.policy), passport.gates);
});

test('a card verifies offline, with no registry access', () => {
  const { state } = setup();
  const card = issueCard(state, { agent: 'agent-bob', asOf: ASOF, timestamp: ASOF });
  const check = verifyCard(card);
  assert.equal(check.ok, true);
  assert.equal(check.contentOk, true);
  assert.equal(check.signatureOk, true);
  assert.equal(check.scoresMatch, true);
});

test('a tampered card fails verification', () => {
  const { state } = setup();
  const card = issueCard(state, { agent: 'agent-bob', asOf: ASOF, timestamp: ASOF });
  const tampered = JSON.parse(JSON.stringify(card));
  tampered.composite = 99.99;
  assert.equal(verifyCard(tampered).ok, false);
});

test('a tampered signature fails verification', () => {
  const { state } = setup();
  const card = issueCard(state, { agent: 'agent-bob', asOf: ASOF, timestamp: ASOF });
  const tampered = { ...card, signature: card.signature.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) };
  assert.equal(verifyCard(tampered).signatureOk, false);
  assert.equal(verifyCard(tampered).ok, false);
});

test('the cards form a chain', () => {
  const { state } = setup();
  const first = issueCard(state, { agent: 'agent-bob', asOf: ASOF, timestamp: ASOF });
  const second = issueCard(state, { agent: 'agent-ava', asOf: ASOF, timestamp: ASOF + 10 });
  assert.equal(first.prevCardHash, '0'.repeat(64));
  assert.equal(second.prevCardHash, first.hash);
});

test('an escrow opens and is funded', () => {
  const { state } = setup();
  const echo = resolveAgent(state, 'client-echo').address;
  const bob = resolveAgent(state, 'agent-bob').address;
  const escrow = openEscrow(state, {
    creator: echo,
    beneficiary: bob,
    amount: 300,
    categories: ['settlement'],
    note: 'work',
    timestamp: ASOF,
  });
  assert.equal(escrow.status, 'OPEN');
  fundEscrow(state, { escrowId: escrow.id, payer: echo, amount: 300, timestamp: ASOF + 60 });
  assert.equal(escrow.status, 'FUNDED');
  assert.equal(state.agents[echo].credits, 700);
  assert.equal(state.agents[bob].credits, 1000);
});

test('an escrow releases when the gates pass', () => {
  const { state } = setup();
  const echo = resolveAgent(state, 'client-echo').address;
  const bob = resolveAgent(state, 'agent-bob').address;
  const escrow = openEscrow(state, {
    creator: echo, beneficiary: bob, amount: 300, categories: ['settlement', 'community'], timestamp: ASOF,
  });
  fundEscrow(state, { escrowId: escrow.id, payer: echo, amount: 300, timestamp: ASOF + 60 });
  releaseEscrow(state, { escrowId: escrow.id, timestamp: ASOF + 120, approver: state.registry });
  assert.equal(escrow.status, 'RELEASED');
  assert.equal(state.agents[bob].credits, 1300);
});

test('an escrow is refused when one category fails, and the money stays put', () => {
  const { state } = setup();
  const echo = resolveAgent(state, 'client-echo').address;
  const ava = resolveAgent(state, 'agent-ava').address;
  const escrow = openEscrow(state, {
    creator: echo, beneficiary: ava, amount: 500, categories: ['settlement', 'community'], timestamp: ASOF,
  });
  fundEscrow(state, { escrowId: escrow.id, payer: echo, amount: 500, timestamp: ASOF + 60 });
  assert.throws(
    () => releaseEscrow(state, { escrowId: escrow.id, timestamp: ASOF + 120, approver: state.registry }),
    /community scores .* needs 50/,
  );
  assert.equal(escrow.status, 'FUNDED');
  assert.equal(state.agents[ava].credits, 1000);
  assert.equal(state.agents[echo].credits, 500);
});

test('the refusal names the failing category and never the composite', () => {
  const { state } = setup();
  const echo = resolveAgent(state, 'client-echo').address;
  const ava = resolveAgent(state, 'agent-ava').address;
  const escrow = openEscrow(state, {
    creator: echo, beneficiary: ava, amount: 500, categories: ['community'], timestamp: ASOF,
  });
  fundEscrow(state, { escrowId: escrow.id, payer: echo, amount: 500, timestamp: ASOF + 60 });
  try {
    releaseEscrow(state, { escrowId: escrow.id, timestamp: ASOF + 120, approver: state.registry });
    assert.fail('the release should have been refused');
  } catch (error) {
    assert.match(error.message, /community/);
    assert.doesNotMatch(error.message, /composite/i);
    assert.ok(error.composite > 70, 'the composite was good, and was still not enough');
  }
});

test('a refused release is recorded in the escrow history', () => {
  const { state } = setup();
  const echo = resolveAgent(state, 'client-echo').address;
  const ava = resolveAgent(state, 'agent-ava').address;
  const escrow = openEscrow(state, {
    creator: echo, beneficiary: ava, amount: 500, categories: ['community'], timestamp: ASOF,
  });
  fundEscrow(state, { escrowId: escrow.id, payer: echo, amount: 500, timestamp: ASOF + 60 });
  try {
    releaseEscrow(state, { escrowId: escrow.id, timestamp: ASOF + 120, approver: state.registry });
  } catch {
    // expected
  }
  const history = escrowHistory(state, echo);
  assert.equal(history.length, 1);
  assert.equal(history[0].history.at(-1).type, 'release_refused');
});

test('a refund returns the money to the payer', () => {
  const { state } = setup();
  const echo = resolveAgent(state, 'client-echo').address;
  const bob = resolveAgent(state, 'agent-bob').address;
  const escrow = openEscrow(state, {
    creator: echo, beneficiary: bob, amount: 300, categories: ['settlement'], timestamp: ASOF,
  });
  fundEscrow(state, { escrowId: escrow.id, payer: echo, amount: 300, timestamp: ASOF + 60 });
  refundEscrow(state, { escrowId: escrow.id, reason: 'the work was not accepted', timestamp: ASOF + 90 });
  assert.equal(escrow.status, 'REFUNDED');
  assert.equal(state.agents[echo].credits, 1000);
});

test('an escrow must name at least one known category', () => {
  const { state } = setup();
  const echo = resolveAgent(state, 'client-echo').address;
  const bob = resolveAgent(state, 'agent-bob').address;
  assert.throws(
    () => openEscrow(state, { creator: echo, beneficiary: bob, amount: 100, categories: [], timestamp: ASOF }),
    /at least one category/,
  );
  assert.throws(
    () => openEscrow(state, { creator: echo, beneficiary: bob, amount: 100, categories: ['charisma'], timestamp: ASOF }),
    /unknown category/,
  );
});

test('a payer cannot fund more than they hold', () => {
  const { state } = setup();
  const echo = resolveAgent(state, 'client-echo').address;
  const bob = resolveAgent(state, 'agent-bob').address;
  const escrow = openEscrow(state, {
    creator: echo, beneficiary: bob, amount: 5000, categories: ['settlement'], timestamp: ASOF,
  });
  assert.throws(
    () => fundEscrow(state, { escrowId: escrow.id, payer: echo, amount: 5000, timestamp: ASOF }),
    /needs 5000/,
  );
});

test('the event log is an unbroken hash chain', () => {
  const { state } = setup();
  emit(state, 'test_event', { a: 1 });
  assert.equal(state.events[0].prevHash, '0'.repeat(64));
  for (let index = 1; index < state.events.length; index += 1) {
    assert.equal(state.events[index].prevHash, state.events[index - 1].hash);
  }
  assert.equal(state.events[state.events.length - 1].hash, hash({
    seq: state.events[state.events.length - 1].seq,
    type: state.events[state.events.length - 1].type,
    payload: state.events[state.events.length - 1].payload,
    prevHash: state.events[state.events.length - 1].prevHash,
  }));
});

test('the same run twice gives the same result', () => {
  const run = () => {
    const { state } = setup();
    const echo = resolveAgent(state, 'client-echo').address;
    const bob = resolveAgent(state, 'agent-bob').address;
    const escrow = openEscrow(state, {
      creator: echo, beneficiary: bob, amount: 300, categories: ['settlement'], timestamp: ASOF,
    });
    fundEscrow(state, { escrowId: escrow.id, payer: echo, amount: 300, timestamp: ASOF + 60 });
    releaseEscrow(state, { escrowId: escrow.id, timestamp: ASOF + 120, approver: state.registry });
    const card = issueCard(state, { agent: 'agent-bob', asOf: ASOF, timestamp: ASOF });
    return `${card.hash}|${state.events.map((event) => event.hash).join(',')}`;
  };
  assert.equal(run(), run());
});

test('the shipped claims file is reproducible from the shipped sources', () => {
  const before = fs.readFileSync(path.join(dir, 'claims.json'), 'utf8');
  execFileSync(process.execPath, [path.join(root, 'scripts/build-claims.mjs')], { cwd: root });
  const after = fs.readFileSync(path.join(dir, 'claims.json'), 'utf8');
  assert.equal(after, before);
});
