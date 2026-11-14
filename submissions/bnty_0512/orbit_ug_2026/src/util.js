// Small deterministic helpers. Node stdlib only -- no third-party code.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto';

export const sha256 = (input) => createHash('sha256').update(input).digest('hex');

/** Recursively sort object keys so JSON serialisation is byte-stable. */
export function sortValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortValue(value[k])]),
    );
  }
  return value;
}

export const canonical = (value) => JSON.stringify(sortValue(value));
export const digestOf = (value) => sha256(canonical(value));

/** Deterministic PRNG (mulberry32) seeded from a string label. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngFrom = (label) => mulberry32(parseInt(sha256(String(label)).slice(0, 8), 16));

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Split an integer total across integer weights, largest-remainder method.
 * The returned parts always sum to `total`.
 */
export function allocateInteger(total, weights) {
  const w = weights.map((x) => Math.max(0, x));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum === 0) return w.map(() => 0);
  const base = w.map((x) => Math.floor((total * x) / sum));
  let remainder = total - base.reduce((a, b) => a + b, 0);
  const order = w
    .map((x, i) => ({ i, rem: (total * x) % sum }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; remainder > 0; k += 1, remainder -= 1) {
    base[order[k % order.length].i] += 1;
  }
  return base;
}

/** Integer micro-NEAR (uNEAR). 1 NEAR = 1_000_000 uNEAR. No floats in money paths. */
export const U = 1_000_000;
export const fmtNEAR = (uNEAR) => `${(uNEAR / U).toFixed(6)} NEAR`;

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Deterministic Ed25519 keypair from a 32-byte seed (offline, no keyserver). */
export function keypairFromSeed(seedHex) {
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seedHex, 'hex')]);
  const priv = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const pubDer = createPublicKey(priv).export({ format: 'der', type: 'spki' });
  const pubRaw = pubDer.subarray(pubDer.length - 32);
  return { priv, pubRaw, publicKeyHex: pubRaw.toString('hex') };
}

export const signWith = (priv, message) => edSign(null, Buffer.from(String(message)), priv);

export function verifyWith(publicKeyRaw, message, signatureHex) {
  const pub = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, publicKeyRaw]),
    format: 'der',
    type: 'spki',
  });
  return edVerify(null, Buffer.from(String(message)), pub, Buffer.from(signatureHex, 'hex'));
}
