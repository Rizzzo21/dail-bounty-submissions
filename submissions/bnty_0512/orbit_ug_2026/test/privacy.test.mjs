import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateFromColumns,
  columnSum,
  mod,
  openCommitment,
  P,
  reconstructRow,
  shieldedCommitment,
  splitSecret,
  toField,
} from '../src/privacy.js';
import { mulberry32, rngFrom } from '../src/util.js';

test('additive secret sharing: shares sum back to the secret', () => {
  const rng = mulberry32(42);
  const secret = 123456n;
  const shares = splitSecret(secret, 5, rng);
  assert.equal(shares.length, 5);
  assert.equal(reconstructRow(shares), toField(secret));
});

test('no single share leaks the secret', () => {
  const rng = mulberry32(7);
  const secret = 999999n;
  const shares = splitSecret(secret, 4, rng);
  for (const share of shares) {
    assert.notEqual(share, toField(secret));
  }
});

test('the aggregate equals the sum of the private values, not any of them', () => {
  const rng = mulberry32(11);
  const n = 5;
  const values = [10n, 20n, 30n, 40n, 50n];
  const shares = values.map((v) => splitSecret(v, n, rng));
  // Each agent holds one column: share j of every secret.
  const columns = [];
  for (let j = 0; j < n; j += 1) {
    columns.push(shares.map((row) => row[j]));
  }
  const columnSums = columns.map((c) => columnSum(c));
  const aggregate = aggregateFromColumns(columnSums);
  const trueSum = values.reduce((a, b) => mod(a + b), 0n);
  assert.equal(aggregate, trueSum);
  // the aggregate is not any individual value
  for (const v of values) assert.notEqual(aggregate, v);
});

test('splitSecret needs at least two agents', () => {
  assert.throws(() => splitSecret(1n, 1, mulberry32(1)), /at least 2/);
});

test('the field arithmetic wraps modulo P', () => {
  assert.equal(toField(P + 5n), 5n);
  assert.equal(mod(-1n), P - 1n);
});

test('a shielded commitment opens only with the right reveal', () => {
  const commitment = shieldedCommitment({ amount: 1_900_000, nonce: 'n1', blinding: 'b1' });
  assert.equal(openCommitment(commitment, { amount: 1_900_000, nonce: 'n1', blinding: 'b1' }), true);
  assert.equal(openCommitment(commitment, { amount: 1_900_001, nonce: 'n1', blinding: 'b1' }), false);
  assert.equal(openCommitment(commitment, { amount: 1_900_000, nonce: 'n2', blinding: 'b1' }), false);
  assert.equal(openCommitment(commitment, { amount: 1_900_000, nonce: 'n1', blinding: 'b2' }), false);
});

test('a commitment does not reveal the amount (it is not the amount)', () => {
  const commitment = shieldedCommitment({ amount: 1_900_000, nonce: 'n1', blinding: 'b1' });
  assert.notEqual(commitment, '1900000');
  assert.equal(commitment.length, 64);
});

test('the split is deterministic for a given rng seed', () => {
  const a = splitSecret(555n, 4, rngFrom('same-seed'));
  const b = splitSecret(555n, 4, rngFrom('same-seed'));
  assert.deepEqual(a, b);
});
