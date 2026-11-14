// Small shared helpers: deterministic hashing, Ed25519 keys, formatting.
// Node standard library only - no third-party dependencies anywhere in this repo.
import crypto from 'node:crypto';

export function sha256Hex(data) {
  const h = crypto.createHash('sha256');
  h.update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
  return h.digest('hex');
}

// Canonical JSON: object keys sorted, so the same state always hashes the same way.
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export const hash = (value) => sha256Hex(canonical(value));

// RFC 8410 PKCS#8 prefix for an Ed25519 private key that carries a raw 32-byte seed.
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// Deterministic keypair: the same seed always yields the same address, so the
// demo and the tests are reproducible byte-for-byte on any machine.
export function keypair(seed) {
  const raw = crypto.createHash('sha256').update(seed, 'utf8').digest();
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = crypto.createPublicKey(privateKey);
  const address = `acc_${sha256Hex(publicKey.export({ type: 'spki', format: 'der' })).slice(0, 16)}`;
  return { privateKey, publicKey, address, seed };
}

export function sign(privateKey, payload) {
  return crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('hex');
}

export function verify(publicKey, payload, signatureHex) {
  try {
    return crypto.verify(null, Buffer.from(payload, 'utf8'), publicKey, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

export const round = (n, d = 8) => Math.round(n * 10 ** d) / 10 ** d;

export const fmtNum = (n) => Math.round(n).toLocaleString('en-US');

export const pct = (n, d = 3) => `${(n * 100).toFixed(d)}%`;
