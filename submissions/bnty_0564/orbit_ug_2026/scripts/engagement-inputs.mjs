#!/usr/bin/env node
// engagement-inputs.mjs — compute the on-chain engagement artefacts for BLIND-ESCROW.
//
//   node scripts/engagement-inputs.mjs --job-id 701 --amount 750 --plaintext "..." --out docs/engagement-inputs.json
//
// The derivations are the ones documented in the entry README, byte for byte:
//
//   blinding_factor = SHA-256("BLIND-ESCROW/DEMO-SEED/v1|" + job_id)            -> 64 hex chars
//   key             = SHA-256("BLIND-ESCROW/DEMO-KEY/v1|" + job_id)             -> 32 bytes
//   iv              = SHA-256("BLIND-ESCROW/DEMO-IV/v1|"  + job_id)[0..12]       -> 12 bytes
//   C               = SHA-256(amount_units + "|" + blinding_hex + "|" + job_id) -> 32 bytes
//   ciphertext      = AES-256-GCM(key, iv, plaintext)                            -> ciphertext||tag
//
// The demo seed keeps the whole trace reproducible (the entry's verify.sh diffs two runs);
// in a real deployment the blinding factor and the key would be random and undisclosed
// until settle.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const jobId = arg('--job-id', '701');
const amount = arg('--amount', '750');
const plaintext = arg('--plaintext', 'CONFIDENTIAL JOB PAYLOAD');
const out = path.resolve(ROOT, arg('--out', 'docs/engagement-inputs.json'));

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest();
const hex = (b) => Buffer.from(b).toString('hex');

const blinding = sha256(`BLIND-ESCROW/DEMO-SEED/v1|${jobId}`);
const key = sha256(`BLIND-ESCROW/DEMO-KEY/v1|${jobId}`);
const iv = sha256(`BLIND-ESCROW/DEMO-IV/v1|${jobId}`).subarray(0, 12);

const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
const ciphertext = Buffer.concat([ct, cipher.getAuthTag()]);

const preimage = `${amount}|${hex(blinding)}|${jobId}`;
const commitment = sha256(preimage);

// the round trip, so the file only ever contains artefacts we actually produced
const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
dec.setAuthTag(ciphertext.subarray(ct.length));
const roundTrip = Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');

const inputs = {
  job_id: jobId,
  amount_units: amount,
  blinding_hex: hex(blinding),
  commitment_hex: hex(commitment),
  commitment_b64: commitment.toString('base64'),
  ciphertext_b64: ciphertext.toString('base64'),
  iv_b64: iv.toString('base64'),
  key_hex: hex(key),
  iv_hex: hex(iv),
  ciphertext_bytes: ciphertext.length,
  plaintext_sha256: hex(sha256(plaintext)),
  preimage,
  decrypt_roundtrip_ok: roundTrip === plaintext,
};

fs.writeFileSync(out, JSON.stringify(inputs, null, 2) + '\n');
console.log(JSON.stringify(inputs, null, 2));
console.log(`\nwrote ${out}`);
console.log(`round trip ok: ${inputs.decrypt_roundtrip_ok}`);
console.log(`recompute C  : ${hex(sha256(preimage))}  (must equal commitment_hex)`);
