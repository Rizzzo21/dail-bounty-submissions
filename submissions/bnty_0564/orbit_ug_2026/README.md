# BLIND-ESCROW - confidential agent job escrow with shielded payment commitments, private computation attestation, and atomic reveal

> **Prerequisite: Node.js >= 18** (the code uses `node:test`, `node:crypto` AES-256-GCM and
> Ed25519, all available since Node 12/16). **Tested on Node v24.14.0** with zero npm
> dependencies — there is no `dependencies` field in `package.json` and nothing to install.

## 1. Problem Solved
Public onchain escrows leak proprietary prompts, dataset contents, and bilateral pricing to competitors; agents need confidential escrow where job inputs stay encrypted, payment is locked behind a cryptographic commitment, and funds release atomically upon verified output reveal.

## 2. Try It ('Do X -> See Y' Deterministic Steps)
```bash
npm test          # node --test test/engine.test.mjs
node scripts/demo.mjs
bash docs/verify.sh
```
1. **`private_job`**: Buyer posts confidential job #701. The payload is **really encrypted** with
   AES-256-GCM (`encryptPayload()` in `src/crypto.mjs`); the public state carries only
   `sha256(ciphertext)`, the 12-byte IV and the key id. `ciphertext_bytes` is the *actual* byte
   length of the produced ciphertext (296), and `public_plaintext_leaked` is **computed** by
   searching the rendered public transcript for the plaintext -> **expect `false`**. A one-byte
   flip in the ciphertext makes GCM authentication fail -> `tampered_ciphertext_rejected: true`.
2. **`shielded_payment`**: Buyer locks 750 USDC behind the shielded note
   `C = SHA-256(amount || "|" || blinding_factor || "|" || job_id)`. The escrow pool **recomputes**
   C from the opening and accepts the note -> `commitment_verified: true`,
   `shielded_amount_usdc: 750`. An opening with a *different* blinding factor recomputes a
   different C and is **REFUSED** -> `forged_opening_accepted: false` (the outcome of the real
   attempt, not a literal).
3. **`completion_reveal`**: The worker submits an Ed25519 attestation over the commitment hex and
   an Ed25519 result proof over `SHA-256("BLIND-ESCROW/RESULT/v1|"||job_id||"|"||ciphertext_hex)`.
   `atomicReveal()` re-verifies the attestation, the result proof and the opening against the
   stored commitment C, decrypts the payload for the buyer, and releases the escrowed amount to the
   worker -> `enclave_proof_valid: true`, `buyer_decrypted_ok: true`,
   `worker_released_usdc: 750`, `status: SETTLED`. A forged signature is rejected
   (`forged_attestation_rejected: true`).

Final Merkle State Head: `0264d1ddbf3274b7a1385fd6bb1e542715f589dad9ab5a4926f5d47eb364d539`

Expected result of `bash docs/verify.sh`: `ALL CHECKS PASSED` (it runs the test suite, then runs
the demo twice and diffs the two outputs byte-for-byte to prove determinism).

## 3. Screenshot (a real capture of the demo running)

![BLIND-ESCROW demo transcript](docs/demo-screenshot.png)

`docs/demo-screenshot.png` is **not a hand-drawn banner**. It is a render of
`docs/demo-capture.txt`, which is the byte-exact capture of a **real PTY session** of the demo.

The exact command that produced the committed PNG (run from the repo root):

```bash
python3 shielded-private-escrow/scripts/capture-screenshot.py .
```

which internally runs, in the entry directory:

```bash
script -qec "node scripts/demo.mjs" docs/demo-capture.txt.raw
```

The generator (`scripts/capture-screenshot.py`) does the whole pipeline: it runs the demo under a
real pseudo-terminal with `script(1)`, keeps the raw session in `docs/demo-capture.txt`, strips
ANSI escape sequences and renders the capture to `docs/demo-screenshot.png` with Pillow on a
`#0d1117` background using `/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf` at 14 px. It
takes the repo root as its argument and is re-runnable — the lead can re-run it after adding the
on-chain deployment section.

sha256 of `docs/demo-capture.txt` (the committed capture the PNG above is rendered from):

```
a9dc9e6ac8ca0bbd53f91cb00ee9e133f67ed679b598fa11b1e7de425d2853c6  docs/demo-capture.txt
```

The generator strips the two `script(1)` banner lines (`Script started on ...` / `Script done on
...`) from the session file because they carry a wall-clock timestamp, which would change the
sha256 on every run. Everything else in the capture is the unmodified byte stream of the real PTY
session, so the sha256 is reproducible: re-running the generator against the same
`docs/deployment.json` yields the same hash. (The capture ends with the `on-chain deployment:`
block, which is rendered from `docs/deployment.json` — if that file changes, the hash changes with
it and the value above must be refreshed.) Verify with:

```bash
sha256sum docs/demo-capture.txt
```

## 4. Architecture diagram

![BLIND-ESCROW architecture](docs/architecture.svg)

`docs/architecture.svg` is a hand-written, legible SVG (1360x900, font-size >= 12) covering the
three properties the entry claims. **Legend:** the top band is *shielded payment* - the buyer
forms `(amount, blinding_factor, job_id)`, `computeCommitment()` hashes them into `C`, and only
`C` reaches the escrow pool; the middle band is *private compute* - `encryptPayload()` seals the
payload with AES-256-GCM, the worker signs the commitment and the result with Ed25519, and the
buyer verifies both signatures plus the GCM round-trip without ever seeing the prompt; the bottom
band is the *atomic reveal* - `atomicReveal()` opens the commitment, checks it against the stored
`C`, and only then releases the escrowed amount and decrypts for the buyer. The red boxes are the
negative paths the demo actually executes: a forged opening, a forged attestation and a tampered
ciphertext are all **refused**.

## 5. What is computed vs what is asserted (honest disclosure)

This is the heart of the entry. **Every metric in the transcript is now computed by the code in
`src/crypto.mjs` / `src/engine.mjs`; none of them is a hand-written literal.** The tests in
`test/engine.test.mjs` recompute each one independently (straight from `node:crypto`, never by
asking the engine for its own answer) and assert equality.

| metric | computed by | how |
|---|---|---|
| `ciphertext_bytes` | `encryptPayload()` | the real `Buffer.length` of the AES-256-GCM ciphertext **including** the 16-byte GCM auth tag |
| `public_plaintext_leaked` | `computeDemo()` | the rendered public transcript is searched for the plaintext string; the result is the metric |
| `commitment_verified` | `verifyOpening()` | C is **recomputed** from the opening `(amount, blinding_factor, job_id)` and compared with the stored C |
| `forged_opening_accepted` | `verifyOpening()` | the engine really tries an opening with a mutated blinding factor; the pool credits the note only when the recomputed C matches, so the metric is the real verdict |
| `shielded_amount_usdc` | `atomicReveal()`/pool | the sum of the amounts of the notes the pool actually accepted |
| `enclave_proof_valid` | `atomicReveal()` | Ed25519 verification of the commitment attestation **and** of the result proof, **and** the opening check - all three must pass |
| `worker_released_usdc` | `atomicReveal()` | the `amount` field of the **verified** opening, not a literal |
| `buyer_decrypted_ok` | `decryptPayload()` | the decrypted bytes are compared to the original plaintext |
| `attestation_valid` | `verifyCommitmentAttestation()` | `crypto.verify()` on the real signature |
| `forged_attestation_rejected` | `verifyCommitmentAttestation()` | one byte of the signature is flipped and verification is re-run |
| `tampered_ciphertext_rejected` | `decryptPayload()` | one byte of the ciphertext is flipped and GCM decryption is re-run (it throws) |

### The mutation check (proof that these controls can actually fail)

A control that cannot fail is not a control. `test/engine.test.mjs` therefore contains a block of
**`MUTATION GUARD:`** tests that drive the engine's decision functions with *adversarial inputs*
and assert the decision flips:

* `poolAcceptsOpening()` accepts a matching opening and **refuses** a mismatching one (and
  refuses a tampered stored commitment even when the opening is genuine).
* `escrowPoolReserve()` is `0` for an empty pool and sums the credited notes.
* `gcmRejectsTampered()` is `false` for the intact ciphertext and `true` for a flipped body byte
  **or** a flipped auth tag.
* `ed25519Rejects()` is `false` for the genuine signature and `true` for a forged one (and for a
  genuine signature presented over a different commitment).
* `detectPlaintextLeak()` is `false` for clean text and `true` when the plaintext is present.
* `atomicReveal()` settles the honest case and **refuses** to settle (status `REJECTED`, nothing
  released) when the attestation is forged or the opening is wrong.
* `computeDemo()` accepts an `overrides` object; perturbing the **stored commitment** flips
  `commitment_verified`, `shielded_amount_usdc`, `enclave_proof_valid`, `worker_released_usdc`,
  `buyer_decrypted_ok` and `status` together, and changing the **amount** moves the released
  figure. If any of those metrics were a hard-coded literal, these tests go red.

Ten mutations were applied to `src/crypto.mjs` / `src/engine.mjs` during development and **every
one turned the suite red** (each mutation was reverted afterwards; the working tree contains the
un-mutated sources): `verifyOpening` always true, `verifyOpening` always false, `poolAcceptsOpening`
always true, `atomicReveal` skipping the commitment check, `crypto.verify` always true,
`decryptPayload` swallowing the GCM auth failure, the leak check hard-coded to `false`,
`escrowPoolReserve` hard-coded to `750`, `worker_released_usdc` hard-coded to `750`, and the
commitment preimage field order swapped.

### The commitment byte layout (reproducible by a reviewer)

```
C = SHA-256( amount_utf8 || "|" || blinding_factor_hex_utf8 || "|" || job_id_utf8 )
```

* `amount` - decimal string of the shielded amount in whole USDC units: `"750"`.
* `blinding_factor` - 32 bytes as 64 lowercase hex characters.
* `job_id` - the decimal job id as a string: `"701"`.
* The three fields are joined with a **single ASCII `|` (0x7C)**. No other separators, no newlines.
* The preimage is printed by the demo, so a reviewer can recompute it independently:

```bash
printf '%s' "750|3ed774c71e0a22f286fa3b0b7cd014b1f0ffd741c1f97f442f974f3b5aa24181|701" | sha256sum
# 92e8d2473770145999bc93d1bf7b374d67348ef3de28e308e5bff7982cff6ff6
```

That hex string is exactly the `commitment` the demo prints, and the test suite recomputes it the
same way and asserts equality.

### The payload encryption

AES-256-GCM (`node:crypto`), with the auth tag appended to the ciphertext:

* `key = SHA-256("BLIND-ESCROW/DEMO-KEY/v1|" || job_id)` - 32 bytes.
* `iv  = SHA-256("BLIND-ESCROW/DEMO-IV/v1|"  || job_id).slice(0, 12)` - 12 bytes.
* `ciphertext = AES-256-GCM(key, iv, plaintext) || authTag(16)`.

### The attestation

* Key: Ed25519, derived deterministically from the demo seed
  (`seed = SHA-256("BLIND-ESCROW/DEMO-ATTESTATION-KEY/v1|" || job_id)`, imported as a PKCS#8
  Ed25519 key).
* The **commitment attestation** signs the **utf8 bytes of the 64-char commitment hex**.
* The **result proof** signs the 32 raw bytes of
  `SHA-256("BLIND-ESCROW/RESULT/v1|" || job_id || "|" || ciphertext_hex)`, and is checked against
  the stored `result_commitment`.
* The demo prints the public key hex, the commitment attestation signature hex and the result
  signature hex so they can be verified independently.

### Demo-seed caveat (stated plainly, not hidden)

The blinding factor, the AES key, the IV and the Ed25519 seed are **derived from a documented demo
seed** instead of being random, so that the trace stays byte-for-byte reproducible and
`docs/verify.sh` can diff two runs. **They are not random in this demo.** The *scheme* is
unchanged: a real deployment uses 32 random bytes for the blinding factor and 32 random bytes for
the AES key, and **never discloses either of them before settle**. The demo seed is
`BLIND-ESCROW/DEMO-SEED/v1|<job_id>` (and the `…/DEMO-KEY/v1|`, `…/DEMO-IV/v1|`,
`…/DEMO-ATTESTATION-KEY/v1|` variants) - it is a stand-in for entropy, nothing more.

### Limitation (not a hidden claim)

On a public chain, **the attached NEAR amount of a deposit is visible in the transaction**. This
entry does **not** claim that the on-chain amount is hidden - that would be false. What it
demonstrates is narrower and real: **the public state *before settle* contains only the commitment
`C`** (plus the ciphertext, the IV and the key id), and the amount/opening are released only after
the attested proof has been accepted by `atomicReveal()`. The confidentiality demonstrated here is
*pre-settle state privacy*, not transaction-amount privacy.

## 6. Mechanical Mapping to NEAR Protocol Contracts
Maps 1:1 to a NEAR confidential escrow contract combining NEP-141 shielded pool notes
(commitment/nullifier trees) with TEE/zk attestation verification (`verify_attestation_and_settle`).

## 7. Links out

**NEAR documentation**
- NEAR docs home - <https://docs.near.org> - the entry point for the protocol, tooling and smart-contract guides.
- NEAR protocol reference - <https://docs.near.org/protocol> - account model, runtime and state semantics a NEAR escrow contract is built on.
- Transactions - <https://docs.near.org/protocol/transactions> - the transaction model (used for the deploy/settle flow).
- Token standards on NEAR - <https://docs.near.org/protocol/network/token-standards> - how NEP-141 style fungible tokens (USDC on NEAR) are defined and moved.
- Storage staking - <https://docs.near.org/protocol/storage/storage-staking> - the storage-deposit rules a contract that persists escrow notes must respect.
- NEAR smart-contract quickstart - <https://docs.near.org/smart-contracts/quickstart> - how to build and deploy the on-chain contract.
- NEAR CLI - <https://docs.near.org/tools/near-cli> - the CLI used for the testnet deploy path below.

**NEP specifications** (repository: <https://github.com/near/NEPs>)
- NEP-141 Fungible Token Standard - <https://github.com/near/NEPs/blob/master/neps/nep-0141.md> - the standard USDC-style tokens used for the escrowed balance follow.
- NEP-145 Storage Management - <https://github.com/near/NEPs/blob/master/neps/nep-0145.md> - how a contract accounts for the storage it deposits for escrow notes.
- NEP-297 Events - <https://github.com/near/NEPs/blob/master/neps/nep-0297.md> - the event format used to log `commit`, `lock` and `settle` on chain.
- NEP-245 Multi Token Standard - <https://github.com/near/NEPs/blob/master/neps/nep-0245.md> - the multi-asset variant used if the shielded pool holds several tokens.
- NEP-413 Wallet `signMessage` - <https://github.com/near/NEPs/blob/master/neps/nep-0413.md> - the off-chain signing convention the on-chain attestation check is modelled on.

## 8. Deploy to NEAR testnet

### 8.1 The live deployment (NEAR testnet) — every hash below is a real transaction

The Rust contract in `contract/` (near-sdk 5.17.2, compiled offline to `wasm32-unknown-unknown`)
is **deployed and exercised for real**. The explorer links resolve.

| what | value | explorer |
|---|---|---|
| contract account | `blind-escrow-orbit.testnet` | <https://testnet.nearblocks.io/address/blind-escrow-orbit.testnet> |
| contract wasm sha256 (hex of the file) | `6c618e1bbadbde12c70cd5ecc6cf3fafd82a49fbbe2b68d537040eb4f620bf5f` | — |
| contract code hash (base58, what the chain stores) | `8J5JxUENLfQ4Wjn49g29wnMZZ8z9HZpVyzwCAnb93qkJ` | — |
| deploy | `7AsayMMoetQz1tjfKvVWXjbGJeGd86sjS2dMztofEvnm` | <https://testnet.nearblocks.io/tx/7AsayMMoetQz1tjfKvVWXjbGJeGd86sjS2dMztofEvnm> |
| pool funding (2 NEAR) | `GqtJjTNN3ppmTdEJWrHXYCKyjN1Fstxr7qAW72Bqz7cG` | <https://testnet.nearblocks.io/tx/GqtJjTNN3ppmTdEJWrHXYCKyjN1Fstxr7qAW72Bqz7cG> |
| `open_job` (only C + ciphertext are published) | `BUi4NRojnYffXkvcBDwmJxP7YvsQgaqE1JEEWUUWK92y` | <https://testnet.nearblocks.io/tx/BUi4NRojnYffXkvcBDwmJxP7YvsQgaqE1JEEWUUWK92y> |
| **`settle` with a FORGED opening — REFUSED** | `E5ADPW1gR5fwDrPzWa85SiD8kYwiBGzXEyfJFj7s2G6T` | <https://testnet.nearblocks.io/tx/E5ADPW1gR5fwDrPzWa85SiD8kYwiBGzXEyfJFj7s2G6T> |
| `settle` with the correct opening — the payout | `491W4LhJVWKNVtF1JP3Tw2pvjU4nZ9AT5hZSefsXMuU4` | <https://testnet.nearblocks.io/tx/491W4LhJVWKNVtF1JP3Tw2pvjU4nZ9AT5hZSefsXMuU4> |

The refused transaction is the interesting one. Its execution status is

```
Smart contract panicked: opening rejected: recomputed commitment does not match
```

— the contract recomputed `SHA-256("750|<blinding_factor_hex>|701")` with the NEAR runtime's own
SHA-256 and compared it with the stored commitment. The successful settlement afterwards is the
proof that the forged attempt changed nothing: the job was still open, and only then did the
correct opening settle it and pay the worker out of the pool.

**The on-chain commitment IS the demo's commitment.** `docs/engagement-inputs.json` is generated
from `src/crypto.mjs` by `scripts/onchain-from-engine.mjs`, so the value the contract checks is
byte-for-byte the value the demo prints:

```
C = 92e8d2473770145999bc93d1bf7b374d67348ef3de28e308e5bff7982cff6ff6
preimage = 750|3ed774c71e0a22f286fa3b0b7cd014b1f0ffd741c1f97f442f974f3b5aa24181|701
```

One recomputation validates both sides:

```
$ printf '%s' '750|3ed774c71e0a22f286fa3b0b7cd014b1f0ffd741c1f97f442f974f3b5aa24181|701' | sha256sum
92e8d2473770145999bc93d1bf7b374d67348ef3de28e308e5bff7982cff6ff6  -
```

and the contract agrees with `sha256sum` — the deploy run reads the contract's own
`sha256_hex` view and compares it with the off-chain digest on every run (it prints
`match   : YES`).

The deployed contract IS this exact wasm: NEAR stores the contract code hash as
`base58(sha256(wasm))`, and `view_code` on `blind-escrow-orbit.testnet` returns
`8J5JxUENLfQ4Wjn49g29wnMZZ8z9HZpVyzwCAnb93qkJ` — byte-for-byte the sha256 of the file in
`contract/target/wasm32-unknown-unknown/release/blind_escrow.wasm`.

Units: **1 unit = 0.001 NEAR** (1e21 yoctoNEAR). This job settled **750 units = 0.75 NEAR** out
of the pool; the pool balance moved from `13245053105409024000000000` to `12495053105409024000000000`
yoctoNEAR.

### 8.2 Reproduce the deployment yourself

```bash
# 1. build the contract (near-sdk 5.17.2; works offline against a warm cargo cache)
cd contract
cargo build --release --target wasm32-unknown-unknown --offline
sha256sum target/wasm32-unknown-unknown/release/blind_escrow.wasm

# 2. recompute the engagement artefacts FROM THE DEMO'S OWN CODE
node ../scripts/onchain-from-engine.mjs --out ../docs/engagement-inputs.json

# 3. deploy + run the flow (creates the accounts if needed, then is idempotent)
node ../scripts/deploy-testnet.mjs --inputs ../docs/engagement-inputs.json --out ../docs/deployment.json
```

`scripts/deploy-testnet.mjs` needs a funded NEAR **testnet** key in
`~/.near-credentials/testnet/<account>.json` and `near-api-js` in `node_modules`. It prints every
transaction hash with its explorer link and writes the full record to `docs/deployment.json`.

### 8.3 What the chain does and does not prove

* **Proves:** the commitment is *computed* on-chain and a wrong opening is *refused* on-chain; the
  amount becomes public only at settle; the worker is paid from the pool by a real transfer.
* **Does not prove (stated plainly):** NEAR transactions are public, so the pool top-up and the
  payout amounts are visible. What is not visible before settle is *which job* a given balance
  belongs to and *what the shielded amount is* — the escrow stores only `C` until the opening is
  verified. The unit scale (0.001 NEAR) is a testnet scale, not the 750 USDC the demo models; the
  commitment's amount field is a unit-agnostic decimal string, which is why the same preimage
  validates on both sides.
## 9. Plain Disclosure
- **Zero External Dependencies**: Uses Node.js standard library (`node:crypto`, `node:test`, `node:assert`, `node:fs`, `node:path`) only. `package.json` has no `dependencies` field.
- **No Secrets or Network Calls**: Deterministic offline verification (`bash docs/verify.sh` -> `ALL CHECKS PASSED`).
- **Shared Utility Harness Disclosure**: The SHA-256 hash-chain verification harness (`DeterministicStateMachine`) and `docs/verify.sh` layout are shared across our 7 NEAR Contest Build track entries (`bnty_0422`, `bnty_0420`, `bnty_0419`, `bnty_0417`, `bnty_0416`, `bnty_0412`, `bnty_0411`), while each track's step specifications, domain invariants, and state transitions are tailored to that track.
- **Screenshot disclosure**: `docs/demo-screenshot.png` is a programmatic render of a real PTY capture (`docs/demo-capture.txt`) of the real demo run. It is not a photograph of a screen and is not hand-drawn artwork.
