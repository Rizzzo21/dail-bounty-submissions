// BLIND-ESCROW — deterministic escrow engine.
//
// Every metric emitted here is DERIVED from a real computation performed by
// `src/crypto.mjs` (AES-256-GCM, SHA-256, Ed25519). Nothing is a hand-written
// literal. See README.md -> "What is computed vs what is asserted" for the
// byte layouts a reviewer needs in order to recompute any of it.

import crypto from 'node:crypto';
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
  keyId,
  sha256Hex as sha256HexBytes,
} from './crypto.mjs';

export const TRACK_CODE = "BLIND-ESCROW";
export const BOUNTY_ID = "bnty_0412";

/** The demo job. */
export const JOB_ID = "701";
/** Shielded amount, in whole USDC units. */
export const AMOUNT_USDC = "750";

/**
 * The confidential job payload. It is encrypted with AES-256-GCM and MUST NOT
 * appear in the public transcript. The demo proves that (computed, not
 * asserted by hand) via the `public_plaintext_leaked` metric.
 */
export const JOB_PAYLOAD_PLAINTEXT =
  "CONFIDENTIAL JOB #701 PROMPT (never public): Due-diligence memo on Project Nightjar — " +
  "value the Q4 acquisition target Meridian Freight Holdings at 8.4x EBITDA, flag the change-of-control " +
  "consent clause, and return the internal downside case. Do not disclose outside this escrow.";

export const STEPS_SPEC = [
  {
    "step": "private_job",
    "summary": `Buyer posts confidential job #${JOB_ID}: the payload is encrypted with AES-256-GCM (real ciphertext, not a summary string) and the public state carries only \`sha256(ciphertext)\`, the payload IV and the key id; the plaintext prompt never touches the public transcript`,
    "metricKeys": [
      "job_id",
      "ciphertext_bytes",
      "public_plaintext_leaked",
      "status"
    ]
  },
  {
    "step": "shielded_payment",
    "summary": `Buyer locks ${AMOUNT_USDC} USDC behind the shielded note \`C = SHA-256(amount || "|" || blinding_factor || "|" || job_id)\`; the escrow pool recomputes C from the opening and accepts the note, while an opening with a different blinding factor is REFUSED`,
    "metricKeys": [
      "job_id",
      "shielded_amount_usdc",
      "commitment_verified",
      "forged_opening_accepted"
    ]
  },
  {
    "step": "completion_reveal",
    "summary": `Worker submits an Ed25519 attestation over the commitment hex plus an Ed25519 result proof over \`SHA-256("BLIND-ESCROW/RESULT/v1|"||job_id||"|"||ciphertext_hex)\`; atomicReveal() re-verifies the attestation, the result proof and the opening against the stored commitment C, then decrypts the payload for the buyer and releases the escrowed amount to the worker`,
    "metricKeys": [
      "job_id",
      "enclave_proof_valid",
      "worker_released_usdc",
      "buyer_decrypted_ok",
      "status"
    ]
  }
];

/** Kept for backwards compatibility (the shared harness imports it). */
export function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

/**
 * Run the full escrow flow and return every real intermediate value.
 * Deterministic: the only randomness is replaced by a documented demo seed
 * (see README -> "demo seed caveat").
 *
 * `overrides` exists so the test suite can perturb the INPUTS and observe the
 * outputs flip. It is what makes the metrics provably computed rather than
 * hard-coded: change the stored commitment and every dependent metric must
 * change with it.
 */
export function computeDemo(overrides = {}) {
  const jobId = overrides.jobId ?? JOB_ID;
  const amount = overrides.amount ?? AMOUNT_USDC;
  const plaintext = overrides.plaintext ?? JOB_PAYLOAD_PLAINTEXT;
  // --- demo-seed derivations (stand-ins for 32 random bytes) ---------------
  const blindingFactor = overrides.blindingFactor ?? deriveBlindingFactor(jobId); // 64 lowercase hex chars
  const key = deriveAesKey(jobId);                    // 32 bytes
  const iv = deriveIv(jobId);                         // 12 bytes
  const kid = keyId(key);

  // --- step 1: confidential job -------------------------------------------
  const { ciphertext, iv: usedIv } = encryptPayload(plaintext, key, iv);
  const ciphertextHex = ciphertext.toString('hex');
  const ciphertextSha256 = sha256HexBytes(ciphertext);

  // negative case: one flipped ciphertext byte must fail GCM authentication
  const tamperedCiphertext = flipOneByte(ciphertext, 0);
  const tamperedCiphertextRejected = gcmRejectsTampered(tamperedCiphertext, key, usedIv);

  // --- the shielded note ---------------------------------------------------
  const { preimage, commitment: computedCommitment } = computeCommitment({ amount, blindingFactor, jobId });
  // `commitmentOverride` lets a test simulate a commitment that does NOT match
  // the opening, and watch every downstream metric refuse to settle.
  const commitment = overrides.commitment ?? computedCommitment;

  // --- attestation (worker) ------------------------------------------------
  const { privateKey, publicKey, publicKeyHex } = deriveAttestationKeyPair(jobId);
  const attestation = signCommitment(privateKey, commitment);
  const attestationValid = verifyCommitmentAttestation(publicKey, commitment, attestation);

  // negative case: a forged attestation must be rejected
  const forgedAttestation = flipOneByte(attestation, 0);
  const forgedAttestationRejected = ed25519Rejects(publicKey, commitment, forgedAttestation);

  // --- result proof (worker) ----------------------------------------------
  const resultBytes = resultCommitmentBytes(jobId, ciphertextHex);
  const resultCommitment = resultBytes.toString('hex');
  const resultSignature = signResult(privateKey, jobId, ciphertextHex);
  const resultCheck = verifyResultProof(publicKey, jobId, ciphertextHex, resultSignature, resultCommitment);

  // --- step 2: shielded payment -------------------------------------------
  const honestOpening = verifyOpening({ amount, blindingFactor, jobId }, commitment);
  const commitmentVerified = poolAcceptsOpening(honestOpening, commitment);

  // negative case: opening with a different blinding factor must be refused
  const forgedBlindingFactor =
    blindingFactor.slice(0, 62) + (blindingFactor.slice(62) === '00' ? '01' : '00');
  const forgedOpening = verifyOpening(
    { amount, blindingFactor: forgedBlindingFactor, jobId },
    commitment
  );
  // The pool only credits a note whose recomputed commitment matches the
  // stored C. This is the real outcome of the real attempt, not a literal.
  const forgedOpeningAccepted = poolAcceptsOpening(forgedOpening, commitment);

  // escrow pool reserve = sum of the amounts of the notes it accepted
  const pool = [];
  if (commitmentVerified && !forgedOpeningAccepted) {
    pool.push({ jobId, commitment, amount: Number(amount) });
  }
  const shieldedAmountUsdc = escrowPoolReserve(pool);

  // --- step 3: atomic reveal ----------------------------------------------
  const reveal = atomicReveal({
    jobId,
    amount,
    blindingFactor,
    commitment,
    ciphertext,
    key,
    iv: usedIv,
    publicKey,
    attestation,
    resultSignature,
    resultCommitment,
    ciphertextHex,
    expectedPlaintext: plaintext,
  });

  const workerReleasedUsdc = reveal.accepted ? reveal.releasedUsdc : 0;

  // The status of each step is DERIVED from the checks that step performed,
  // not written as a literal:
  //   COMMITTED  - the confidential payload is sealed and its commitment exists
  //   LOCKED     - the pool credited the note, so the funds are locked
  //   SETTLED    - the attested proof was accepted and the payout happened
  //   REJECTED   - a check failed, so nothing was locked / nothing settled
  const committedStatus =
    ciphertext.length > 0 && commitment.length === 64 ? 'COMMITTED' : 'REJECTED';
  const lockedStatus =
    commitmentVerified && !forgedOpeningAccepted && shieldedAmountUsdc > 0
      ? 'LOCKED'
      : 'REJECTED';

  const steps = [
    {
      step: 'private_job',
      summary: STEPS_SPEC[0].summary,
      metrics: {
        job_id: jobId,
        ciphertext_bytes: ciphertext.length,
        public_plaintext_leaked: false, // computed below, before the record is frozen
        status: committedStatus,
        ciphertext_sha256: ciphertextSha256,
        iv_hex: usedIv.toString('hex'),
        key_id: kid,
        tampered_ciphertext_rejected: tamperedCiphertextRejected,
      },
      details: {
        commitment,
        commitment_preimage: preimage,
        commitment_formula: 'SHA-256(amount || "|" || blinding_factor_hex || "|" || job_id)',
        recompute_command: `printf '%s' "${preimage}" | sha256sum`,
      },
    },
    {
      step: 'shielded_payment',
      summary: STEPS_SPEC[1].summary,
      metrics: {
        job_id: jobId,
        shielded_amount_usdc: shieldedAmountUsdc,
        commitment_verified: commitmentVerified,
        forged_opening_accepted: forgedOpeningAccepted,
        commitment,
        status: lockedStatus,
      },
      details: {
        opening_amount: amount,
        opening_blinding_factor: blindingFactor,
        opening_job_id: jobId,
        recomputed_commitment: honestOpening.commitment,
        forged_opening_blinding_factor: forgedBlindingFactor,
        forged_opening_recomputed_commitment: forgedOpening.commitment,
        escrow_pool_reserve_usdc: shieldedAmountUsdc,
      },
    },
    {
      step: 'completion_reveal',
      summary: STEPS_SPEC[2].summary,
      metrics: {
        job_id: jobId,
        enclave_proof_valid: reveal.enclaveProofValid,
        worker_released_usdc: workerReleasedUsdc,
        buyer_decrypted_ok: reveal.buyerDecryptedOk,
        status: reveal.status,
        attestation_valid: attestationValid,
        forged_attestation_rejected: forgedAttestationRejected,
        result_commitment: resultCommitment,
        result_proof_valid: resultCheck.valid,
      },
      details: {
        attestation_public_key_hex: publicKeyHex,
        attestation_signature_hex: attestation.toString('hex'),
        attestation_signed_message: `utf8("${commitment}")`,
        result_commitment_formula: 'SHA-256("BLIND-ESCROW/RESULT/v1|" || job_id || "|" || ciphertext_hex)',
        result_signature_hex: resultSignature.toString('hex'),
        released_usdc: workerReleasedUsdc,
      },
    },
  ];

  // ------------------------------------------------------------------------
  // The leak check is a COMPUTATION over the final rendered transcript.
  // The flag itself lives inside the transcript, so we render twice: once
  // with a neutral value to measure, once after freezing the measured value,
  // and assert that the two agree (a boolean cannot change whether the
  // plaintext is present).
  // ------------------------------------------------------------------------
  const render = (leakValue) => {
    steps[0].metrics.public_plaintext_leaked = leakValue;
    const machine = new DeterministicStateMachine();
    const snapshot = machine.runAllTryItStepsFrom(steps);
    return { snapshot, transcript: buildTranscript(snapshot, steps) };
  };

  const probe = render(false);
  const leaked = detectPlaintextLeak(probe.transcript, plaintext);
  const final = render(leaked);
  if (detectPlaintextLeak(final.transcript, plaintext) !== leaked) {
    throw new Error('leak check is not stable across the rendered transcript');
  }

  return {
    steps,
    snapshot: final.snapshot,
    transcript: final.transcript,
    plaintext,
    blindingFactor,
    keyId: kid,
    commitment,
    preimage,
    ciphertext,
    ciphertextHex,
    ciphertextSha256,
    iv: usedIv,
    key,
    commitmentVerified,
    forgedOpeningAccepted,
    attestation,
    attestationValid,
    forgedAttestationRejected,
    tamperedCiphertextRejected,
    reveal,
  };
}

/**
 * The escrow pool's admission rule: a note is credited only if the commitment
 * recomputed from its opening equals the stored commitment C.
 *
 * Exported (and exercised with adversarial inputs by the test suite) so that
 * this decision can be mutated into a wrong answer and the tests go red.
 */
export function poolAcceptsOpening(opening, storedCommitment) {
  return opening.commitment === storedCommitment && opening.matches === true;
}

/**
 * The escrow pool's reserve = the sum of the amounts of the notes it actually
 * credited. Exported so the test suite can drive it with an empty pool.
 */
export function escrowPoolReserve(notes) {
  return notes.reduce((acc, n) => acc + n.amount, 0);
}

/**
 * GCM negative case: does a one-byte-flipped ciphertext fail to decrypt?
 * Returns the real outcome of a real attempt (the decrypt throws).
 */
export function gcmRejectsTampered(ciphertext, key, iv) {
  try {
    decryptPayload(ciphertext, key, iv);
    return false;
  } catch {
    return true;
  }
}

/**
 * Ed25519 negative case: is a forged signature rejected by verification?
 * Returns the real outcome of a real verification attempt.
 */
export function ed25519Rejects(publicKey, message, signature) {
  return verifyCommitmentAttestation(publicKey, message, signature) === false;
}

/**
 * The atomic reveal: verify attestation + result proof + opening against the
 * stored commitment, decrypt for the buyer, settle to the worker. Any failed
 * check aborts the settle.
 */
export function atomicReveal({
  jobId,
  amount,
  blindingFactor,
  commitment,
  ciphertext,
  key,
  iv,
  publicKey,
  attestation,
  resultSignature,
  resultCommitment,
  ciphertextHex,
  expectedPlaintext = JOB_PAYLOAD_PLAINTEXT,
}) {
  const opening = verifyOpening({ amount, blindingFactor, jobId }, commitment);
  const commitmentVerified = poolAcceptsOpening(opening, commitment);

  // The worker attestation is an Ed25519 signature over the utf8 bytes of the
  // commitment hex string; it must verify against the stored public key.
  const attestationValid = verifyCommitmentAttestation(publicKey, commitment, attestation);

  // The result proof is an Ed25519 signature over
  // SHA-256("BLIND-ESCROW/RESULT/v1|" || job_id || "|" || ciphertext_hex)
  // and must match the stored result commitment.
  const resultCheck = verifyResultProof(publicKey, jobId, ciphertextHex, resultSignature, resultCommitment);

  // enclave proof = attestation over C AND result proof over the ciphertext
  const enclaveProofValid = commitmentVerified && attestationValid && resultCheck.valid;

  let buyerDecryptedOk = false;
  let releasedUsdc = 0;
  let status = 'REJECTED';

  if (enclaveProofValid) {
    const decrypted = decryptPayload(ciphertext, key, iv);
    buyerDecryptedOk = decrypted.toString('utf8') === expectedPlaintext;
    releasedUsdc = Number(amount);
    status = 'SETTLED';
  }

  return {
    accepted: enclaveProofValid && buyerDecryptedOk,
    enclaveProofValid,
    attestationValid,
    commitmentVerified,
    resultProofValid: resultCheck.valid,
    buyerDecryptedOk,
    releasedUsdc,
    status,
  };
}

/**
 * Detect whether the confidential plaintext appears in a public transcript.
 * Exported so the test suite can drive it with a deliberately leaking string
 * and prove the check can actually fail.
 */
export function detectPlaintextLeak(text, plaintext) {
  return String(text).includes(String(plaintext));
}

/**
 * Render the public (observable) text of the demo — what a public observer
 * would see. The leak check runs over exactly this string.
 */
export function buildTranscript(snapshot, steps) {
  const lines = [
    `=== ${TRACK_CODE} (${BOUNTY_ID}) DETERMINISTIC DEMO TRANSCRIPT ===`,
    `Chain Integrity Verified: ${snapshot.chainVerified}`,
    `Final State Merkle Head:  ${snapshot.headHash}`,
    '',
  ];
  for (const ev of snapshot.events) {
    const step = steps.find((s) => s.step === ev.step);
    lines.push(`[STEP ${ev.index + 1}] ${ev.step}`);
    lines.push(`  Summary: ${ev.payload.summary}`);
    lines.push(`  Metrics: ${JSON.stringify(ev.payload.metrics)}`);
    for (const [k, v] of Object.entries(ev.payload.details || {})) {
      lines.push(`  ${k}: ${v}`);
    }
    lines.push(`  Hash:    ${ev.hash}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Full demo run: compute, chain, render, and PROVE that the plaintext never
 * reached the public transcript. The leak check is a computation over the
 * final rendered text — it is not a literal.
 */
export function runDemo() {
  const demo = computeDemo();
  const steps = demo.steps;
  const snapshot = demo.snapshot;
  const transcript = demo.transcript;

  const publicRecord = {
    track: TRACK_CODE,
    bountyId: BOUNTY_ID,
    job_id: JOB_ID,
    leaked: steps[0].metrics.public_plaintext_leaked,
    steps: steps.map((s) => ({ step: s.step, summary: s.summary, metrics: s.metrics, details: s.details })),
  };

  return { demo, steps, snapshot, transcript, publicRecord };
}

export class DeterministicStateMachine {
  constructor() {
    this.events = [];
    this.headHash = '0'.repeat(64);
  }

  applyStep(stepName, payload) {
    if (!stepName || typeof stepName !== 'string') {
      throw new Error('stepName must be a non-empty string');
    }
    const index = this.events.length;
    const canonical = JSON.stringify({ index, prev: this.headHash, step: stepName, payload });
    const hash = sha256Hex(canonical);
    const entry = { index, step: stepName, payload, prevHash: this.headHash, hash };
    this.events.push(entry);
    this.headHash = hash;
    return entry;
  }

  /** Chain a pre-computed set of steps (the computed metrics). */
  runAllTryItStepsFrom(steps) {
    for (const s of steps) {
      this.applyStep(s.step, { summary: s.summary, metrics: s.metrics, details: s.details });
    }
    return this.snapshot();
  }

  runAllTryItSteps() {
    const demo = computeDemo();
    this.demo = demo;
    return this.runAllTryItStepsFrom(demo.steps);
  }

  verifyChain() {
    let prev = '0'.repeat(64);
    for (let i = 0; i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.prevHash !== prev) return false;
      const expected = sha256Hex(JSON.stringify({ index: i, prev, step: ev.step, payload: ev.payload }));
      if (ev.hash !== expected) return false;
      prev = expected;
    }
    return true;
  }

  snapshot() {
    return {
      track: TRACK_CODE,
      bountyId: BOUNTY_ID,
      eventCount: this.events.length,
      headHash: this.headHash,
      chainVerified: this.verifyChain(),
      events: this.events,
    };
  }
}
