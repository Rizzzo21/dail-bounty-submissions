import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ReputationPassport,
  PASSPORT_BASE_SCORE,
  scoreDelta,
  issuerKeypair,
} from '../src/reputation.js';

test('a fresh passport starts at the base score', () => {
  const p = new ReputationPassport({ agentId: 'a.near' });
  assert.equal(p.score, PASSPORT_BASE_SCORE);
  assert.equal(p.events.length, 0);
  assert.equal(p.head, 'genesis');
});

test('a settled job moves the score by quality', () => {
  const p = new ReputationPassport({ agentId: 'a.near' });
  p.append('job_settled', { job_id: 'j', price: 10, quality: 1 });
  assert.equal(p.score, PASSPORT_BASE_SCORE + 5);
  p.append('job_settled', { job_id: 'k', price: 10, quality: 0 });
  assert.equal(p.score, PASSPORT_BASE_SCORE);
});

test('a default is punished', () => {
  const p = new ReputationPassport({ agentId: 'a.near' });
  p.append('job_defaulted', { job_id: 'j', price: 10, quality: 0.1 });
  assert.equal(p.score, PASSPORT_BASE_SCORE - 20);
});

test('the score is clamped to [0, 100]', () => {
  const p = new ReputationPassport({ agentId: 'a.near' });
  for (let i = 0; i < 20; i += 1) p.append('job_defaulted', { job_id: `j${i}` });
  assert.equal(p.score, 0);
  const q = new ReputationPassport({ agentId: 'b.near' });
  for (let i = 0; i < 20; i += 1) q.append('job_settled', { job_id: `j${i}`, quality: 1 });
  assert.equal(q.score, 100);
});

test('the event log is hash-linked and tamper evident', () => {
  const p = new ReputationPassport({ agentId: 'a.near' });
  p.append('job_settled', { job_id: 'j', quality: 0.8 });
  p.append('job_settled', { job_id: 'k', quality: 0.9 });
  const doc = p.toJSON();
  assert.equal(ReputationPassport.verifyChain(doc).valid, true);
  doc.events[0].data.quality = 0.1;
  const check = ReputationPassport.verifyChain(doc);
  assert.equal(check.valid, false);
  assert.match(check.reason, /bad hash/);
});

test('a passport is portable: export, verify elsewhere, re-import', () => {
  const p = new ReputationPassport({ agentId: 'a.near' });
  p.append('job_awarded', { job_id: 'j', price: 5 });
  p.append('job_settled', { job_id: 'j', price: 5, quality: 0.9 });
  const json = JSON.stringify(p.toJSON());
  const reimported = ReputationPassport.fromJSON(JSON.parse(json));
  assert.equal(reimported.score, p.score);
  assert.equal(reimported.id, p.id);
  assert.equal(reimported.head, p.head);
  assert.equal(ReputationPassport.verifyChain(reimported.toJSON()).valid, true);
});

test('the passport id is stable for the same agent and issuer', () => {
  const a = new ReputationPassport({ agentId: 'a.near' });
  const b = new ReputationPassport({ agentId: 'a.near' });
  const c = new ReputationPassport({ agentId: 'a.near', issuer: 'other' });
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.match(a.id, /^passport:[0-9a-f]{32}$/);
});

test('the issuer signature verifies', () => {
  const issuer = issuerKeypair('test-issuer');
  const p = new ReputationPassport({ agentId: 'a.near' });
  p.append('job_settled', { job_id: 'j', quality: 0.7 });
  p.sign(issuer);
  assert.equal(p.verifySignature(issuer.pubRaw), true);
  const other = issuerKeypair('other-issuer');
  assert.equal(p.verifySignature(other.pubRaw), false);
});

test('the escrow history lists only money events', () => {
  const p = new ReputationPassport({ agentId: 'a.near' });
  p.append('registered', { public_key_hex: 'x' });
  p.append('job_awarded', { job_id: 'j', price: 5 });
  p.append('job_settled', { job_id: 'j', price: 5, quality: 0.8 });
  p.append('collective_purchase', { purchase_id: 'p' });
  const history = p.escrowHistory();
  assert.equal(history.length, 3);
  assert.ok(history.every((e) => e.type !== 'registered'));
});

test('scoreDelta is 0 for unknown events', () => {
  assert.equal(scoreDelta({ type: 'something_else', data: {} }), 0);
});
