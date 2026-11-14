// Privacy primitives.
//
// 1. `shieldedCommitment` / `openCommitment` -- a one-way commitment to a payment
//    amount. The escrow publishes only the commitment; the amount is revealed when
//    the job completes and the reveal is checked against the commitment.
//
// 2. Additive secret sharing over a prime field -- n agents split a private value
//    into n shares, each agent keeps exactly one column, and the *sum* of the
//    private values is recovered by summing the published column sums. No individual
//    value is recoverable from the published transcript: recovering one needs the
//    full row of shares, and each published column is a sum over all agents.
import { canonical, sha256 } from './util.js';

export const P = 2305843009213693951n; // 2^61 - 1, a Mersenne prime

export const mod = (x) => ((x % P) + P) % P;

export const toField = (value) => mod(BigInt(value));

/**
 * Split `secret` into `n` additive shares that sum back to the secret.
 * Shares are handed to different agents; nobody keeps the secret itself.
 */
export function splitSecret(secret, n, rng) {
  if (n < 2) throw new Error('need at least 2 agents for secret sharing');
  const shares = [];
  let acc = 0n;
  for (let i = 0; i < n - 1; i += 1) {
    const raw = BigInt(Math.floor(rng() * 1e9)) * BigInt(i + 1) + BigInt(Math.floor(rng() * 1e6));
    const s = toField(raw);
    shares.push(s);
    acc = mod(acc + s);
  }
  shares.push(mod(toField(secret) - acc));
  return shares;
}

/** Sum of one column across all agents (this is all that ever gets published). */
export function columnSum(column) {
  return column.reduce((a, b) => mod(a + b), 0n);
}

/** The public aggregate: sum of the private values, without revealing any of them. */
export function aggregateFromColumns(columnSums) {
  return columnSums.reduce((a, b) => mod(a + b), 0n);
}

/** Recover a single secret from a full row of shares (used only in tests). */
export function reconstructRow(row) {
  return row.reduce((a, b) => mod(a + b), 0n);
}

/** One-way commitment to an amount (uNEAR) with a nonce and blinding factor. */
export const shieldedCommitment = ({ amount, nonce, blinding }) =>
  sha256(canonical({ amount, nonce, blinding }));

/** Verify a reveal against a published commitment. */
export const openCommitment = (commitment, { amount, nonce, blinding }) =>
  sha256(canonical({ amount, nonce, blinding })) === commitment;
