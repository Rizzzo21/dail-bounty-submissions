#!/usr/bin/env node
// onchain-from-engine.mjs — build the on-chain engagement inputs FROM THE ENGINE'S OWN CODE.
//
//   node scripts/onchain-from-engine.mjs --out docs/engagement-inputs.json
//
// The point of this script: the artefact that goes on-chain is produced by the very same
// functions the demo runs. There is no second implementation of the commitment anywhere, so
// the preimage a reviewer recomputes off-chain is byte-for-byte the preimage the contract
// checks on-chain - one recomputation validates both.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeCommitment, deriveBlindingFactor, deriveAesKey, deriveIv, encryptPayload,
} from '../src/crypto.mjs';
import { JOB_ID, AMOUNT_USDC, JOB_PAYLOAD_PLAINTEXT } from '../src/engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const out = path.resolve(ROOT, arg('--out', 'docs/engagement-inputs.json'));

const jobId = String(JOB_ID);
const amount = String(AMOUNT_USDC);
const plaintext = String(JOB_PAYLOAD_PLAINTEXT);

const blinding = deriveBlindingFactor(jobId);
const key = deriveAesKey(jobId);
const iv = deriveIv(jobId);
const { preimage, commitment } = computeCommitment({ amount, blindingFactor: blinding, jobId });
const { ciphertext, iv: usedIv } = encryptPayload(plaintext, key, iv);

const inputs = {
  job_id: jobId,
  amount_units: amount,
  blinding_hex: blinding.toString('hex'),
  commitment_hex: commitment,
  commitment_b64: Buffer.from(commitment, 'hex').toString('base64'),
  ciphertext_b64: Buffer.from(ciphertext).toString('base64'),
  iv_b64: Buffer.from(usedIv).toString('base64'),
  ciphertext_bytes: ciphertext.length,
  plaintext_sha256: null,
  preimage,
  source: 'scripts/onchain-from-engine.mjs (src/crypto.mjs + src/engine.mjs)',
};

fs.writeFileSync(out, JSON.stringify(inputs, null, 2) + '\n');
console.log(JSON.stringify(inputs, null, 2));
console.log(`\nwrote ${out}`);
console.log(`preimage : ${preimage}`);
console.log(`commitment: ${commitment}`);
console.log(`ciphertext bytes: ${ciphertext.length}`);
