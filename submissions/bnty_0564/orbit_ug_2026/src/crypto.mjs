// BLIND-ESCROW — real cryptographic primitives (Node standard library only).
//
// Everything in this file is a REAL computation: no metric in the demo is a
// hand-written literal. Every function here can be recomputed by a reviewer
// from the byte layout documented in README.md.
//
// The only concession to reproducibility is the *seed derivation*: in a real
// deployment the blinding factor, the AES key and the IV are 32/32/12 random
// bytes that are never disclosed before settle. Here they are derived from a
// documented demo seed so that `docs/verify.sh` can run the demo twice and
// diff the output byte-for-byte. The SCHEME is unchanged; only the entropy
// source differs. See README "What is computed vs what is asserted".

import crypto from 'node:crypto';

/** Domain-separation tags for the deterministic demo derivations. */
export const TAGS = {
  blinding: 'BLIND-ESCROW/DEMO-SEED/v1',
  aesKey: 'BLIND-ESCROW/DEMO-KEY/v1',
  iv: 'BLIND-ESCROW/DEMO-IV/v1',
  attestationKey: 'BLIND-ESCROW/DEMO-ATTESTATION-KEY/v1',
  result: 'BLIND-ESCROW/RESULT/v1',
};

/** sha256 over a Buffer or a utf8 string -> 64 lowercase hex chars. */
export function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** sha256 over a Buffer or a utf8 string -> 32 raw bytes. */
export function sha256Bytes(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return crypto.createHash('sha256').update(buf).digest();
}

/**
 * Deterministic demo derivation: SHA-256("<TAG>|" + job_id).
 * The trailing "|" is part of the tag literal, exactly as documented.
 */
export function deriveDemoBytes(tag, jobId) {
  return sha256Bytes(`${tag}|${jobId}`);
}

/** 32-byte blinding factor, rendered as 64 lowercase hex chars. */
export function deriveBlindingFactor(jobId) {
  return deriveDemoBytes(TAGS.blinding, jobId).toString('hex');
}

/** 32-byte AES-256-GCM key. */
export function deriveAesKey(jobId) {
  return deriveDemoBytes(TAGS.aesKey, jobId);
}

/** 12-byte GCM IV. */
export function deriveIv(jobId) {
  return deriveDemoBytes(TAGS.iv, jobId).subarray(0, 12);
}

/** Short, non-secret identifier of the AES key (for the public transcript). */
export function keyId(key) {
  return sha256Hex(key).slice(0, 16);
}

// ---------------------------------------------------------------------------
// 1. Commitment
// ---------------------------------------------------------------------------
//   C = SHA-256( amount_utf8 || "|" || blinding_factor_hex_utf8 || "|" || job_id_utf8 )
// The three fields are joined with a single ASCII "|" (0x7C). No newlines.
export function commitmentPreimage({ amount, blindingFactor, jobId }) {
  return `${String(amount)}|${String(blindingFactor)}|${String(jobId)}`;
}

export function computeCommitment({ amount, blindingFactor, jobId }) {
  const preimage = commitmentPreimage({ amount, blindingFactor, jobId });
  return { preimage, commitment: sha256Hex(Buffer.from(preimage, 'utf8')) };
}

/**
 * Recompute a commitment from an "opening" (amount, blinding_factor, job_id)
 * and compare it with the stored commitment. Returns the recomputed value and
 * whether it matches — the caller decides what to do with a mismatch.
 */
export function verifyOpening({ amount, blindingFactor, jobId }, storedCommitment) {
  const { preimage, commitment } = computeCommitment({ amount, blindingFactor, jobId });
  return { preimage, commitment, matches: commitment === storedCommitment };
}

// ---------------------------------------------------------------------------
// 2. Payload encryption (AES-256-GCM)
// ---------------------------------------------------------------------------
export function encryptPayload(plaintext, key, iv) {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  // createCipheriv's GCM auth tag is appended by the caller convention:
  // ciphertext || authTag(16 bytes).
  const ciphertext = Buffer.concat([ct, cipher.getAuthTag()]);
  return { ciphertext, iv, keyId: keyId(key) };
}

/** Throws when GCM authentication fails (tampered ciphertext). */
export function decryptPayload(ciphertext, key, iv) {
  const body = ciphertext.subarray(0, ciphertext.length - 16);
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

// ---------------------------------------------------------------------------
// 3. Ed25519 attestation (deterministic key from the demo seed)
// ---------------------------------------------------------------------------
// PKCS#8 wrapper for a raw 32-byte Ed25519 seed.
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
// SubjectPublicKeyInfo wrapper for a raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Build a deterministic Ed25519 private KeyObject from a 32-byte seed. */
export function ed25519PrivateKeyFromSeed(seed) {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) {
    throw new Error('Ed25519 seed must be exactly 32 bytes');
  }
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/** Deterministic Ed25519 key pair for the demo job id. */
export function deriveAttestationKeyPair(jobId) {
  const seed = deriveDemoBytes(TAGS.attestationKey, jobId);
  const privateKey = ed25519PrivateKeyFromSeed(seed);
  const publicKey = crypto.createPublicKey(privateKey);
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const rawPublic = spki.subarray(spki.length - 32);
  return {
    privateKey,
    publicKey,
    publicKeyHex: rawPublic.toString('hex'),
    seedHex: seed.toString('hex'),
  };
}

/** Ed25519 signature over raw bytes (null algorithm => Ed25519). */
export function signBytes(privateKey, data) {
  return crypto.sign(null, Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'), privateKey);
}

/** Ed25519 verification. Returns a real boolean. */
export function verifyBytes(publicKey, data, signature) {
  return crypto.verify(
    null,
    Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'),
    publicKey,
    signature,
  );
}

/**
 * The worker attestation: Ed25519 signature over the UTF-8 bytes of the
 * commitment hex string (64 ASCII chars).
 */
export function signCommitment(privateKey, commitmentHex) {
  return signBytes(privateKey, Buffer.from(commitmentHex, 'utf8'));
}

export function verifyCommitmentAttestation(publicKey, commitmentHex, signature) {
  return verifyBytes(publicKey, Buffer.from(commitmentHex, 'utf8'), signature);
}

/**
 * The result commitment used by the atomic reveal:
 *   result_commitment = SHA-256("BLIND-ESCROW/RESULT/v1|" + job_id + "|" + ciphertext_hex)
 * and the worker signs the 32 raw digest bytes.
 */
export function resultCommitmentBytes(jobId, ciphertextHex) {
  return sha256Bytes(`${TAGS.result}|${jobId}|${ciphertextHex}`);
}

export function signResult(privateKey, jobId, ciphertextHex) {
  return signBytes(privateKey, resultCommitmentBytes(jobId, ciphertextHex));
}

export function verifyResultProof(publicKey, jobId, ciphertextHex, signature, expectedHex) {
  const digest = resultCommitmentBytes(jobId, ciphertextHex);
  const signedOk = verifyBytes(publicKey, digest, signature);
  const matches = digest.toString('hex') === expectedHex;
  return { signedOk, matches, valid: signedOk && matches };
}

/** Flip one bit of a buffer (used for the negative cases). */
export function flipOneByte(buf, index = 0) {
  const copy = Buffer.from(buf);
  const i = index % copy.length;
  copy[i] = copy[i] ^ 0x01;
  return copy;
}
