import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  DeterministicStateMachine,
  STEPS_SPEC,
  sha256Hex,
  runDemo,
  computeDemo,
  JOB_ID,
  AMOUNT_USDC,
  JOB_PAYLOAD_PLAINTEXT,
  poolAcceptsOpening,
  escrowPoolReserve,
  gcmRejectsTampered,
  ed25519Rejects,
  detectPlaintextLeak,
  atomicReveal,
} from '../src/engine.mjs';
import {
  deriveBlindingFactor,
  deriveAesKey,
  deriveIv,
  encryptPayload,
  decryptPayload,
  computeCommitment,
  verifyOpening,
  deriveAttestationKeyPair,
  signCommitment,
  verifyCommitmentAttestation,
  resultCommitmentBytes,
  signResult,
  verifyResultProof,
  flipOneByte,
} from '../src/crypto.mjs';

test('deterministic state machine executes all 3 try-it steps identically across runs', () => {
  const m1 = new DeterministicStateMachine().runAllTryItSteps();
  const m2 = new DeterministicStateMachine().runAllTryItSteps();
  assert.equal(m1.eventCount, 3);
  assert.equal(m1.chainVerified, true);
  assert.equal(m1.headHash, m2.headHash);
  assert.deepEqual(m1.events, m2.events);
});

test('tampering with any event payload invalidates hash chain verification', () => {
  const m = new DeterministicStateMachine();
  m.runAllTryItSteps();
  assert.equal(m.verifyChain(), true);
  m.events[1].payload = { summary: 'tampered', metrics: {} };
  assert.equal(m.verifyChain(), false);
});

test('rejects empty step names', () => {
  const m = new DeterministicStateMachine();
  assert.throws(() => m.applyStep('', {}), /stepName must be a non-empty string/);
});

test('each try-it step produces non-empty metrics and valid 64-hex SHA-256 digest', () => {
  const snap = new DeterministicStateMachine().runAllTryItSteps();
  for (let i = 0; i < STEPS_SPEC.length; i++) {
    assert.equal(snap.events[i].step, STEPS_SPEC[i].step);
    assert.match(snap.events[i].hash, /^[0-9a-f]{64}$/);
    assert.ok(Object.keys(snap.events[i].payload.metrics).length > 0);
  }
});

// ---------------------------------------------------------------------------
// The crypto proofs. Every assertion below recomputes the value independently
// (node:crypto directly, or the documented byte layout) instead of asking the
// engine for its own answer.
// ---------------------------------------------------------------------------

test('commitment C is recomputed independently and matches the engine', () => {
  const { snapshot } = runDemo();
  const metrics = snapshot.events[0].payload.metrics;
  const details = snapshot.events[0].payload.details;

  // independent recomputation, straight from the documented byte layout
  const blinding = deriveBlindingFactor(JOB_ID);
  const preimage = `${AMOUNT_USDC}|${blinding}|${JOB_ID}`;
  const expected = crypto.createHash('sha256').update(Buffer.from(preimage, 'utf8')).digest('hex');

  assert.equal(details.commitment_preimage, preimage);
  assert.equal(details.commitment, expected);
  assert.equal(details.commitment, snapshot.events[1].payload.metrics.commitment);
  assert.match(expected, /^[0-9a-f]{64}$/);
});

test('commitment preimage recomputes with the documented sha256 formula', () => {
  const { snapshot } = runDemo();
  const details = snapshot.events[0].payload.details;
  const expected = crypto
    .createHash('sha256')
    .update(Buffer.from(details.commitment_preimage, 'utf8'))
    .digest('hex');
  assert.equal(details.commitment, expected);
  // the preimage is exactly three "|"-joined fields, no newlines
  const parts = details.commitment_preimage.split('|');
  assert.equal(parts.length, 3);
  assert.equal(parts[0], AMOUNT_USDC);
  assert.equal(parts[1], deriveBlindingFactor(JOB_ID));
  assert.equal(parts[2], JOB_ID);
  assert.ok(!details.commitment_preimage.includes('\n'));
});

test('the demo seed derivation is reproducible and the blinding factor is 32 bytes of hex', () => {
  const b = deriveBlindingFactor(JOB_ID);
  assert.match(b, /^[0-9a-f]{64}$/);
  assert.equal(b.length, 64);
  assert.equal(b, crypto.createHash('sha256').update(`BLIND-ESCROW/DEMO-SEED/v1|${JOB_ID}`).digest('hex'));
  // and it is job-scoped
  assert.notEqual(b, deriveBlindingFactor('702'));
});

test('ciphertext_bytes is the real byte length of the produced ciphertext, not a literal', () => {
  const { demo, snapshot } = runDemo();
  const bytes = snapshot.events[0].payload.metrics.ciphertext_bytes;
  assert.equal(typeof bytes, 'number');
  assert.equal(bytes, demo.ciphertext.length);
  // plaintext length + GCM auth tag
  assert.equal(bytes, Buffer.byteLength(JOB_PAYLOAD_PLAINTEXT, 'utf8') + 16);
});

test('AES-256-GCM round-trips: the buyer decrypts back to the exact plaintext', () => {
  const key = deriveAesKey(JOB_ID);
  const iv = deriveIv(JOB_ID);
  const { ciphertext } = encryptPayload(JOB_PAYLOAD_PLAINTEXT, key, iv);
  const out = decryptPayload(ciphertext, key, iv).toString('utf8');
  assert.equal(out, JOB_PAYLOAD_PLAINTEXT);
  assert.equal(runDemo().snapshot.events[2].payload.metrics.buyer_decrypted_ok, true);
});

test('a tampered ciphertext fails GCM authentication', () => {
  const key = deriveAesKey(JOB_ID);
  const iv = deriveIv(JOB_ID);
  const { ciphertext } = encryptPayload(JOB_PAYLOAD_PLAINTEXT, key, iv);
  const tampered = flipOneByte(ciphertext, 0);
  assert.notDeepEqual(tampered, ciphertext);
  assert.throws(() => decryptPayload(tampered, key, iv));
  // and the engine reports the real outcome of that attempt
  assert.equal(runDemo().snapshot.events[0].payload.metrics.tampered_ciphertext_rejected, true);
});

test('a forged opening is refused: the recomputed C differs from the stored C', () => {
  const { snapshot } = runDemo();
  const metrics = snapshot.events[1].payload.metrics;
  const details = snapshot.events[1].payload.details;

  // independent recomputation of the forged opening
  const forgedBf = details.forged_opening_blinding_factor;
  const forgedPreimage = `${AMOUNT_USDC}|${forgedBf}|${JOB_ID}`;
  const forgedC = crypto.createHash('sha256').update(Buffer.from(forgedPreimage, 'utf8')).digest('hex');
  assert.equal(details.forged_opening_recomputed_commitment, forgedC);
  assert.notEqual(forgedC, details.recomputed_commitment);
  assert.notEqual(forgedC, metrics.commitment);

  // the engine's real verdict
  assert.equal(metrics.forged_opening_accepted, false);
  assert.equal(metrics.commitment_verified, true);
  // and verifyOpening reports the same thing when driven independently
  const forged = verifyOpening({ amount: AMOUNT_USDC, blindingFactor: forgedBf, jobId: JOB_ID }, metrics.commitment);
  assert.equal(forged.matches, false);
});

test('an honest opening verifies against the stored commitment', () => {
  const { snapshot } = runDemo();
  const metrics = snapshot.events[1].payload.metrics;
  const details = snapshot.events[1].payload.details;
  const honest = verifyOpening(
    { amount: details.opening_amount, blindingFactor: details.opening_blinding_factor, jobId: details.opening_job_id },
    metrics.commitment
  );
  assert.equal(honest.matches, true);
  assert.equal(honest.commitment, metrics.commitment);
});

test('a forged attestation is rejected by Ed25519 verification', () => {
  const { demo, snapshot } = runDemo();
  const details = snapshot.events[2].payload.details;

  const { publicKey } = deriveAttestationKeyPair(JOB_ID);
  const good = signCommitment(deriveAttestationKeyPair(JOB_ID).privateKey, demo.commitment);
  assert.equal(verifyCommitmentAttestation(publicKey, demo.commitment, good), true);

  const forged = flipOneByte(good, 0);
  assert.equal(verifyCommitmentAttestation(publicKey, demo.commitment, forged), false);

  assert.equal(snapshot.events[2].payload.metrics.forged_attestation_rejected, true);
  assert.equal(snapshot.events[2].payload.metrics.attestation_valid, true);
});

test('the attestation signature is a real Ed25519 signature over the commitment hex', () => {
  const { demo } = runDemo();
  const { privateKey, publicKey } = deriveAttestationKeyPair(JOB_ID);
  const sig = signCommitment(privateKey, demo.commitment);
  assert.equal(sig.length, 64);
  // independent verification with node:crypto directly
  const ok = crypto.verify(null, Buffer.from(demo.commitment, 'utf8'), publicKey, sig);
  assert.equal(ok, true);
});

test('the result proof binds the ciphertext and verifies against the stored result commitment', () => {
  const { demo, snapshot } = runDemo();
  const metrics = snapshot.events[2].payload.metrics;

  // independent recomputation of the result commitment
  const expected = crypto
    .createHash('sha256')
    .update(`BLIND-ESCROW/RESULT/v1|${JOB_ID}|${demo.ciphertextHex}`)
    .digest('hex');
  assert.equal(metrics.result_commitment, expected);
  assert.equal(metrics.result_commitment, resultCommitmentBytes(JOB_ID, demo.ciphertextHex).toString('hex'));

  const { privateKey, publicKey } = deriveAttestationKeyPair(JOB_ID);
  const sig = signResult(privateKey, JOB_ID, demo.ciphertextHex);
  const check = verifyResultProof(publicKey, JOB_ID, demo.ciphertextHex, sig, metrics.result_commitment);
  assert.equal(check.valid, true);
  assert.equal(metrics.result_proof_valid, true);

  // a signature over a different ciphertext must not verify
  const other = verifyResultProof(publicKey, JOB_ID, '00'.repeat(64), sig, metrics.result_commitment);
  assert.equal(other.valid, false);
});

test('the released amount is derived from the commitment opening, not a literal', () => {
  const { snapshot } = runDemo();
  const released = snapshot.events[2].payload.metrics.worker_released_usdc;
  const reserved = snapshot.events[1].payload.metrics.shielded_amount_usdc;
  assert.equal(released, reserved);
  assert.equal(released, Number(AMOUNT_USDC));
  assert.equal(snapshot.events[2].payload.metrics.status, 'SETTLED');
});

test('the plaintext does NOT appear anywhere in the produced public transcript', () => {
  const { transcript, publicRecord } = runDemo();
  assert.equal(transcript.includes(JOB_PAYLOAD_PLAINTEXT), false);
  assert.equal(JSON.stringify(publicRecord).includes(JOB_PAYLOAD_PLAINTEXT), false);
  // and the engine's own leak metric agrees, computed rather than asserted
  assert.equal(runDemo().snapshot.events[0].payload.metrics.public_plaintext_leaked, false);
  // sanity: the plaintext is a non-trivial string, so this is not vacuous
  assert.ok(JOB_PAYLOAD_PLAINTEXT.length > 80);
});

test('demo output is byte-identical across runs (determinism)', () => {
  const a = runDemo();
  const b = runDemo();
  assert.equal(a.transcript, b.transcript);
  assert.equal(a.snapshot.headHash, b.snapshot.headHash);
  assert.deepEqual(a.publicRecord, b.publicRecord);
});

test('the demo seed derivations are deterministic and job-scoped', () => {
  assert.equal(deriveAesKey(JOB_ID).toString('hex'), deriveAesKey(JOB_ID).toString('hex'));
  assert.notEqual(deriveAesKey(JOB_ID).toString('hex'), deriveAesKey('702').toString('hex'));
  assert.equal(deriveIv(JOB_ID).length, 12);
  assert.equal(deriveAesKey(JOB_ID).length, 32);
});

test('commitment helper agrees with an independent hash of the documented layout', () => {
  const c = computeCommitment({ amount: '750', blindingFactor: 'ab'.repeat(32), jobId: '701' });
  assert.equal(c.preimage, '750|' + 'ab'.repeat(32) + '|701');
  assert.equal(c.commitment, sha256Hex(c.preimage));
});

// ---------------------------------------------------------------------------
// MUTATION RESISTANCE.
//
// A control that cannot fail is not a control. Each test below drives the
// engine's decision functions with an ADVERSARIAL input and asserts the
// decision flips. If someone hard-codes a metric (e.g. `forged_opening_accepted
// = false`) instead of computing it, the corresponding test below goes red.
// ---------------------------------------------------------------------------

test('MUTATION GUARD: poolAcceptsOpening() accepts a matching opening and refuses a mismatching one', () => {
  const { snapshot } = runDemo();
  const metrics = snapshot.events[1].payload.metrics;
  const details = snapshot.events[1].payload.details;

  // matching opening -> accepted
  const good = verifyOpening(
    { amount: details.opening_amount, blindingFactor: details.opening_blinding_factor, jobId: details.opening_job_id },
    metrics.commitment
  );
  assert.equal(poolAcceptsOpening(good, metrics.commitment), true);

  // mismatching opening -> refused. If the rule were hard-coded to `true`,
  // this assertion fails.
  const bad = verifyOpening(
    { amount: details.opening_amount, blindingFactor: details.forged_opening_blinding_factor, jobId: details.opening_job_id },
    metrics.commitment
  );
  assert.equal(poolAcceptsOpening(bad, metrics.commitment), false);
});

test('MUTATION GUARD: poolAcceptsOpening() refuses a tampered commitment even with a matching opening', () => {
  const { snapshot } = runDemo();
  const metrics = snapshot.events[1].payload.metrics;
  const details = snapshot.events[1].payload.details;

  const good = verifyOpening(
    { amount: details.opening_amount, blindingFactor: details.opening_blinding_factor, jobId: details.opening_job_id },
    metrics.commitment
  );
  // a different stored commitment must be refused
  assert.equal(poolAcceptsOpening(good, 'f'.repeat(64)), false);
});

test('MUTATION GUARD: escrowPoolReserve() sums the credited notes and is 0 for an empty pool', () => {
  assert.equal(escrowPoolReserve([]), 0);
  assert.equal(escrowPoolReserve([{ amount: 750 }]), 750);
  assert.equal(escrowPoolReserve([{ amount: 750 }, { amount: 250 }]), 1000);
});

test('MUTATION GUARD: gcmRejectsTampered() returns true for a flipped byte and false for the intact ciphertext', () => {
  const key = deriveAesKey(JOB_ID);
  const iv = deriveIv(JOB_ID);
  const { ciphertext } = encryptPayload(JOB_PAYLOAD_PLAINTEXT, key, iv);
  // the intact ciphertext decrypts -> NOT rejected
  assert.equal(gcmRejectsTampered(ciphertext, key, iv), false);
  // a flipped byte is rejected
  assert.equal(gcmRejectsTampered(flipOneByte(ciphertext, 0), key, iv), true);
  // a flipped AUTH TAG is rejected too
  const last = flipOneByte(ciphertext, ciphertext.length - 1);
  assert.equal(gcmRejectsTampered(last, key, iv), true);
});

test('MUTATION GUARD: ed25519Rejects() returns true for a forged signature and false for the genuine one', () => {
  const { demo } = runDemo();
  const { privateKey, publicKey } = deriveAttestationKeyPair(JOB_ID);
  const good = signCommitment(privateKey, demo.commitment);
  assert.equal(ed25519Rejects(publicKey, demo.commitment, good), false);
  assert.equal(ed25519Rejects(publicKey, demo.commitment, flipOneByte(good, 0)), true);
  // a signature over a DIFFERENT commitment is rejected as well
  assert.equal(ed25519Rejects(publicKey, 'a'.repeat(64), good), true);
});

test('MUTATION GUARD: detectPlaintextLeak() returns true when the plaintext IS in the text', () => {
  assert.equal(detectPlaintextLeak('nothing to see here', JOB_PAYLOAD_PLAINTEXT), false);
  assert.equal(
    detectPlaintextLeak(`public text ${JOB_PAYLOAD_PLAINTEXT} more public text`, JOB_PAYLOAD_PLAINTEXT),
    true
  );
});

test('MUTATION GUARD: atomicReveal() refuses to settle when the attestation is forged', () => {
  const { demo } = runDemo();
  const { privateKey, publicKey } = deriveAttestationKeyPair(JOB_ID);
  const base = {
    jobId: JOB_ID,
    amount: AMOUNT_USDC,
    blindingFactor: demo.blindingFactor,
    commitment: demo.commitment,
    ciphertext: demo.ciphertext,
    key: demo.key,
    iv: demo.iv,
    publicKey,
    attestation: signCommitment(privateKey, demo.commitment),
    resultSignature: signResult(privateKey, JOB_ID, demo.ciphertextHex),
    resultCommitment: resultCommitmentBytes(JOB_ID, demo.ciphertextHex).toString('hex'),
    ciphertextHex: demo.ciphertextHex,
  };

  // the honest reveal settles
  const good = atomicReveal(base);
  assert.equal(good.enclaveProofValid, true);
  assert.equal(good.buyerDecryptedOk, true);
  assert.equal(good.releasedUsdc, 750);
  assert.equal(good.status, 'SETTLED');

  // a forged attestation -> no settle, nothing released
  const forged = atomicReveal({ ...base, attestation: flipOneByte(base.attestation, 0) });
  assert.equal(forged.enclaveProofValid, false);
  assert.equal(forged.buyerDecryptedOk, false);
  assert.equal(forged.releasedUsdc, 0);
  assert.equal(forged.status, 'REJECTED');

  // a wrong opening -> no settle
  const wrongOpening = atomicReveal({ ...base, blindingFactor: demo.blindingFactor.slice(0, 62) + '00' });
  assert.equal(wrongOpening.commitmentVerified, false);
  assert.equal(wrongOpening.enclaveProofValid, false);
  assert.equal(wrongOpening.status, 'REJECTED');
});

test('MUTATION GUARD: perturbing the stored commitment flips every dependent metric (nothing is hard-coded)', () => {
  // A different stored commitment: the opening no longer matches it, so the
  // pool must refuse the note, the pool reserve must be 0, the reveal must be
  // REJECTED and nothing may be released. If any of these were a literal,
  // this test fails.
  const bad = computeDemo({ commitment: 'a'.repeat(64) });
  const m1 = bad.steps[0].metrics;
  const m2 = bad.steps[1].metrics;
  const m3 = bad.steps[2].metrics;

  assert.equal(m2.commitment_verified, false);
  assert.equal(m2.shielded_amount_usdc, 0);
  assert.equal(m3.enclave_proof_valid, false);
  assert.equal(m3.worker_released_usdc, 0);
  assert.equal(m3.buyer_decrypted_ok, false);
  assert.equal(m3.status, 'REJECTED');

  // and the honest run still passes every one of those checks
  const good = computeDemo();
  assert.equal(good.steps[1].metrics.commitment_verified, true);
  assert.equal(good.steps[1].metrics.shielded_amount_usdc, 750);
  assert.equal(good.steps[2].metrics.enclave_proof_valid, true);
  assert.equal(good.steps[2].metrics.worker_released_usdc, 750);
  assert.equal(good.steps[2].metrics.buyer_decrypted_ok, true);
  assert.equal(good.steps[2].metrics.status, 'SETTLED');
});

test('MUTATION GUARD: the released amount tracks the amount in the opening', () => {
  const other = computeDemo({ amount: '1234' });
  assert.equal(other.steps[1].metrics.shielded_amount_usdc, 1234);
  assert.equal(other.steps[2].metrics.worker_released_usdc, 1234);
  // the commitment changed with the amount
  assert.notEqual(other.steps[0].details.commitment, computeDemo().steps[0].details.commitment);
});

test('MUTATION GUARD: the leak flag flips to true when the plaintext IS in the public transcript', () => {
  // a payload that is deliberately echoed into the public record must be
  // detected. We do that by making the demo's own plaintext identical to a
  // string that the transcript prints.
  const leaky = computeDemo({ plaintext: '750' });
  // "750" appears in the transcript (the commitment preimage), so it leaks
  assert.equal(leaky.steps[0].metrics.public_plaintext_leaked, true);
  // and the honest payload does not leak
  assert.equal(computeDemo().steps[0].metrics.public_plaintext_leaked, false);
});

test('MUTATION GUARD: ciphertext_bytes tracks the actual plaintext length', () => {
  const short = computeDemo({ plaintext: 'tiny' });
  assert.equal(short.steps[0].metrics.ciphertext_bytes, Buffer.byteLength('tiny', 'utf8') + 16);
  const long = computeDemo({ plaintext: 'x'.repeat(1000) });
  assert.equal(long.steps[0].metrics.ciphertext_bytes, 1000 + 16);
});

test('MUTATION GUARD: the status transitions are derived, not hard-coded', () => {
  const good = computeDemo();
  assert.equal(good.steps[0].metrics.status, 'COMMITTED');
  assert.equal(good.steps[1].metrics.status, 'LOCKED');
  assert.equal(good.steps[2].metrics.status, 'SETTLED');

  // break the commitment -> the pool must not lock and the reveal must not settle
  const bad = computeDemo({ commitment: 'b'.repeat(64) });
  assert.equal(bad.steps[1].metrics.status, 'REJECTED');
  assert.equal(bad.steps[2].metrics.status, 'REJECTED');
});
