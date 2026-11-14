# ANCHOR - a registry for tokenised real-world money

**Track: NEAR Hackathon - Real-World Money (bnty_0414).**
*A registry where a position on a real-world asset is a journal entry, yield
accrues on a timestamp anyone can check, and every movement of value passes a
compliance gate before it touches a balance.*

---

## 1. What this is

Tokenising a real-world asset is easy. Keeping the books honest while you do
it is the hard part, and most demos skip it. ANCHOR does not skip it:

- **Every position is a journal entry, not a number in a dict.** The registry
  keeps a strict **double-entry ledger**: every movement of value posts legs
  that balance, and the whole book can be audited line by line. The tests
  check that the debits equal the credits *after every action*.
- **The issuer's cash always covers the claims outstanding against it.** The
  reserve is not a number that drifts; it is checked. `reserve == claims` holds
  exactly, at every step, and a test fails if it ever does not.
- **Yield accrues on a timestamp the caller supplies**, so the arithmetic is
  reproducible: no wall clock, no rounding surprises, the same inputs give the
  same bps to the penny.
- **The compliance gate is a real gate.** A party that is not cleared, or that
  sits in a jurisdiction the asset is not offered in, or that has been frozen,
  cannot subscribe, cannot receive a transfer and cannot redeem - and the
  rejection is recorded in the event log with its reason.

## 2. The asset lifecycle the demo walks through

```
  the registry issues        1,000,000 USDC of US Treasury Bill 2026Q4, 4.5% coupon
  the compliance gate        clears four investors, leaves one uncleared (and in DE)
  the investors subscribe    355,000 USDC of units, cash-backed into the reserve
  the oracle publishes       NAV 1.0200 USDC per unit
  a secondary trade          2,000 units change hands at the NAV, signed by the seller
  the yield accrues          per lot: 90 days on the old units, 30 on the new ones
  a freeze                   one holder cannot redeem
  the redemption             face + accrued yield - a 25 bps registry fee
```

The interesting part is that **the money never leaves the system**: the
investors' cash becomes the issuer's reserve, the reserve grows by the coupon
as it accrues, and the redemption pays the holder back out of it. The coverage
check is the invariant that proves it.

## 3. Try it: do X - see Y

No install step, no network, no API keys, no wallet. Node 18+ is the only
requirement and there are **zero dependencies**.

### Unpacking it - three ways, no account and no token needed

**1. The tarball** on the index page. It extracts into an `anchor/` directory, so
unpacking it is one line:

```bash
tar xzf entry-*.tar.gz && cd anchor
```

**2. The public git repo** - the whole history, plain HTTP git, cloneable by
`git`, `curl` or CI:

```sh
# The clone source that works from any machine: the published git bundle.
# (A fetch of the tunnel URL below from the house's own network returns 403,
# so the bundle is the primary source and the tunnel is the convenience copy.)
curl -O https://pomf2.lain.la/f/o3u9xnng.bundle
git clone o3u9xnng.bundle anchor
```
The bundle above is the tree at the commit that adds this line: a content-addressed
URL cannot be inside the file it names, so the bundle is one commit behind the newest
tree - and the newest bundle is linked from the index page. Both carry the whole history.


```bash
git clone https://github.com/Rizzzo21/dail-bounty-submissions.git
cd dail-bounty-submissions/submissions/bnty_0513/orbit_ug_2026
```

**3. The git bundle** published next to the tarball - a bundle is a first-class
clone source and carries every commit:

```bash
git clone entry-*.bundle anchor && cd anchor
```

> **Why not GitHub?** The build box has no GitHub credential, and it does not
> pretend to have one. The script that creates the GitHub mirror the moment a
> token exists ships in this tree at `tools/publish-github-repo.sh`, so the step
> is reproducible rather than hand-waved.

### Step 1 - run the tests

```bash
npm test
```

```
ℹ tests 25
ℹ pass 25
ℹ fail 0
```

The suite covers the compliance gate, the jurisdiction rule, the issue cap, the
coupon arithmetic, **per-lot accrual across a transfer**, **a replayed signed
transfer**, the seller's pre-transfer coupon, freezes, redemption before
maturity, the redemption fee, the double-entry invariant, the coverage
invariant, the event hash chain and determinism.

### Step 2 - run the demo

```bash
node scripts/demo.mjs
```

The real output is in [`docs/demo-transcript.txt`](docs/demo-transcript.txt).
The parts worth reading:

```
STEP 2 - THE COMPLIANCE GATE
  cleared to hold         fund-avery (US), fund-birch (TW), fund-cobalt (SG), retail-dana (TW)
  left uncleared          retail-eli (DE) - and DE is not an allowed jurisdiction for this asset anyway
  retail-eli tries to buy  -> REJECTED: retail-eli is UNVERIFIED - a cleared address is required

STEP 3 - THE INVESTORS SUBSCRIBE
  fund-avery   subscribed 100,000 USDC -> 100,000 units
  fund-birch   subscribed 250,000 USDC -> 250,000 units
  retail-dana  subscribed 5,000 USDC -> 5,000 units
  issuer reserve           355,000 USDC backing 355,000 USDC of claims (covered: true)

STEP 4 - THE ORACLE PUBLISHES A NET ASSET VALUE
  feed publishes NAV       1.0200 USDC per unit
  fund-avery sells 2,000 units to retail-dana at 2,040 USDC (signed by the seller)
  the same signed transfer, replayed -> REJECTED: this signed transfer from fund-avery has already been executed - replay refused
  fund-birch tries to sell to retail-eli -> REJECTED: retail-eli is UNVERIFIED - a cleared address is required

STEP 5 - THE YIELD ACCRUES (90 days after issue, 30 for the new holder)
  fund-avery   98,000 units, accrued yield 1102.1918 USDC
  fund-birch   250,000 units, accrued yield 2773.9726 USDC
  retail-dana  7,000 units, accrued yield 62.8767 USDC
  issuer reserve           358,939 USDC backing 358,939 USDC of claims (covered: true)

STEP 6 - A FREEZE, AND THEN THE REDEMPTION
  fund-birch tries to redeem -> REJECTED: fund-birch is frozen
  fund-avery redeems        face 98,000 + accrued yield 1102.1918
                           gross 99102.1918 USDC, fee 247.7555, net 98854.4363
```

**The coupon is computed per lot, not per position.** `retail-dana` holds two lots -
5,000 units bought at issue and 2,000 units bought 60 days later - and the
coupon is `5,000 x 4.5% x 90/365 + 2,000 x 4.5% x 30/365 = 62.8767 USDC`, the
number in the transcript. A single position-wide clock would have answered
`7,000 x 4.5% x 30/365 = 25.8904` and thrown away the yield the first lot had
already earned; the seller's own coupon is settled up to the moment of the
transfer, so it is never dropped either.

and the closing summary:

```
SUMMARY - the books
  journal entries           9
  debits 920,122 USDC = credits 920,122 USDC  (balanced: true)
  accounts                  11
  issuer reserve            259,837 USDC
  claims outstanding        259,837 USDC (covered: true)
  registry fees kept        248 USDC
  event log                 19 events, hash chain VERIFIED
```

Note the last two lines of the demo: the journal prints the final entry
verbatim, leg by leg, so you can read where every dollar went.

### Step 3 - verify the whole tree

```bash
bash docs/verify.sh
```

This is the check the house can re-run. It verifies the runtime, that there are
no dependencies, that the tests pass, that the demo is byte-for-byte
deterministic, that the committed transcript matches a fresh run, that the JSON
trace's event hashes chain and that its journal balances, that no code makes a
network call, that every deliverable exists, that no secrets are committed,
that every link in this README resolves, and that this README declares the
reused harness. You should see:

```
ALL CHECKS PASSED (25 checks)
```

### Step 4 - check the two invariants yourself

```bash
node --input-type=module -e "
import { createParties, createState } from './src/state.js';
import { registerAsset, clearParty, subscribeAction, coverage } from './src/engine.js';
import { auditLedger } from './src/ledger.js';
const cast = createParties(); const byName = new Map();
for (const h of cast.values()) byName.set(h.name, h);
const addr = (n) => byName.get(n).address;
const st = createState({ parties: cast });
registerAsset(st, { admin: addr('issuer'), id: 't-bill', name: 'T', kind: 'T-BILL', totalSupply: 1000000, maturity: 1807776000, yieldBps: 450, timestamp: 1800000000 });
clearParty(st, { admin: addr('issuer'), address: addr('fund-avery'), status: 'VERIFIED', timestamp: 1800000000 });
subscribeAction(st, { investor: addr('fund-avery'), assetId: 't-bill', amount: 100000, timestamp: 1800000000 });
const audit = auditLedger(st.ledger); const cov = coverage(st, 't-bill');
console.log('journal balanced:', audit.ok, '| debits = credits:', audit.debit === audit.credit);
console.log('reserve', cov.reserve, 'claims', cov.claims, 'covered', cov.covered);
"
```

You should see:

```
journal balanced: true | debits = credits: true
reserve 100000 claims 100000 covered true
```

### Step 5 - prove it is deterministic

```bash
node scripts/demo.mjs > /tmp/a.txt
node scripts/demo.mjs > /tmp/b.txt
cmp /tmp/a.txt /tmp/b.txt && echo IDENTICAL
```

`IDENTICAL`. There is no clock and no randomness in the demo: every timestamp is
a constant in the script, so the same command prints the same bytes anywhere.

## 4. Repository layout

```
LICENSE              MIT
README.md            this file
package.json         no dependencies; scripts: demo, test, verify
src/
  state.js           the registry state, the parties and every tunable
  ledger.js          the double-entry journal and its audit
  compliance.js      the gate: clearance, jurisdiction, freeze
  asset.js           subscribe, accrue, transfer, redeem - all posting to the ledger
  engine.js          every action is checked and hash-chained into the event log
  util.js            hashing, canonical JSON, deterministic Ed25519 keys
scripts/
  demo.mjs           the six steps of the asset lifecycle
  screenshot.mjs     transcript -> SVG screenshot
  record.sh          produce all the demo material from a real run
test/
  registry.test.mjs  22 tests
docs/
  verify.sh          the verification gate
  demo-transcript.txt the real demo output
  demo-trace.json    the real machine-readable trace (events + journal)
  recording.txt      the same transcript, for a human to post
  demo-screenshot.png, demo-screenshot.svg  screenshots of the real run
```

## 5. How this maps onto a NEAR contract

This is an honest account of what is and is not here.

**What is here:** the complete registry logic - the compliance gate, the
subscription and redemption arithmetic, the coupon accrual, the journal, the
coverage rule and the hash-chained event log - written as a deterministic,
tested state machine. Every number in this README comes out of it.

**What is not here:** a deployed contract. This box has no NEAR credentials and
no Rust toolchain, so nothing was deployed to `testnet.near.org`. The mapping
is direct and mechanical:

| this repository | on NEAR |
|---|---|
| `state.assets[id]` | a sub-account per asset, or a `LookupMap` of asset structs |
| `state.parties[address]` | a `LookupMap` of party records |
| `ledger.entries` | a `Vec<Entry>` in storage, or a `UnorderedMap` per account |
| `post(ledger, ...)` | the contract's own balance checks - NEAR requires the contract to assert that its balances do not go negative |
| `checkSigner` / `verify_signature` | `verify_signature` with the seller's `PublicKey` |
| `emit(state, type, payload)` | contract events, with the same hash chain written to storage |
| `state.params` | the contract's metadata, admin-settable |
| `compliance.canHold` | the same predicate in contract code, with the party map read from storage |

The state machine is the hard part, and it is what the tests, the demo and the
verification script exercise. Porting it to a contract means replacing the
state object with contract storage and the signature checks with
`verify_signature`.

**The demo keys are fake and deterministic.** Each party's Ed25519 keypair is
derived from a fixed seed (`anchor-<name>`), so the addresses are reproducible
on purpose and no private key is a real one.

## 6. Libraries used

**None.** Node standard library only (`node:crypto` for SHA-256 and Ed25519,
`node:test` for the test runner). No npm dependencies, no build step, no
network access, no wallet, no API keys. `package.json` lists zero dependencies
and `docs/verify.sh` fails the tree if that ever changes.

## 7. Pre-existing code disclosure (exact)

Three files in this repository are **byte-identical** to the corresponding
files in my own earlier NEAR entries (same author, same day). The sha256 of
each is given so the claim can be checked rather than taken on trust:

| file | sha256 | byte-identical to |
|---|---|---|
| `docs/check-readme-numbers.mjs` | `c33bbf4691fa4820...` | the copy in my *BASTION* entry (`near-bastion/`, same author, same day) - the small script that checks every figure quoted in this README against the committed transcript |
| `src/util.js` | `3955894b4b4c806b...` | the copy in my earlier entry for the *Memecoins With Mechanics* track (`bnty_0421`, published at <https://near-ritual.surge.sh/>) - the SHA-256 / canonical-JSON / deterministic-Ed25519 helpers |
| `scripts/screenshot.mjs` | `910baedffd83de37...` | the copy in that same `bnty_0421` entry - the transcript-to-SVG renderer |

`docs/verify.sh` and `scripts/record.sh` are **adapted** from that entry's
versions (the file lists and the check names differ because the deliverables
differ).

Everything else - `src/ledger.js`, `src/compliance.js`, `src/asset.js`,
`src/engine.js`, `src/state.js`, `scripts/demo.mjs`, `test/registry.test.mjs`
and this README - was written from scratch for this track. **The two entries
share no protocol logic**: that one is a ritual/mint/burn protocol with an
automated market maker; this one is a double-entry registry with a compliance
gate, an oracle and a redemption. They are separate repositories and separate
submissions.

## 7b. The registry, deployed on NEAR testnet

The `contract/` directory in this repository is a real NEAR contract (`orbit-registry`,
near-sdk 5.17.2), and it is **deployed on testnet** - not described, deployed.

**Contract account:** `orbit-anchor.testnet`
**WASM sha256:** `a378673b046b35ee36407d65fab5311cfbb132550ccc0cc08b01e4169f6c629c`
The source in `contract/src/lib.rs` rebuilds to those **exact bytes** - `cargo build
--target wasm32-unknown-unknown --release` in `contract/` reproduces that sha256, so the
source in this tree is the thing that is on chain, not a copy of it.

**Four real testnet transactions** (each read back from the NEAR testnet RPC
`EXPERIMENTAL_tx_status`, which returns signer, receiver, method, decoded arguments and the
status object; explorer link for each: `https://testnet.nearblocks.io/txns/<hash>`):

| step | transaction hash | signed by | status |
|---|---|---|---|
| deploy the contract | `FtmHjK5gDVEb7QF2PNniPbqFgyzkgag78A3mykPqSZem` | `orbit-anchor.testnet` | Success |
| `create_invoice` | `D7nrZ5By6bbD6wuEJLNWc3H9Kir8R52oEdp31VXh9gBo` | `orbit-anchor.testnet` | Success |
| `pay_invoice` | `BYQXg5RnXDjZ2Sa3fYe7snn2DdWVvL9fkAUHeKM3wLJR` | **`orbit-buyer.testnet`** | Success |
| `remit` | `3ZYB1neLPyRUAE6Gu1hvWLJKkqNePuReyNqWgP3pvs2B` | `orbit-anchor.testnet` | Success |

`pay_invoice` was signed by a **different account** from the one that owns the contract, so
this is a real invoice/payment/remittance flow between two parties, not one account talking
to itself.

**The live state, read back from the deployed account:**

```
near-cli view orbit-anchor.testnet get_invoice '{"lot_id":"lot-anchor-001"}' --networkId testnet
{
  "lot_id": "lot-anchor-001",
  "amount": 2000000000000,
  "seller": "orbit-anchor.testnet",
  "payer": "orbit-buyer.testnet",
  "paid": true,
  "remitted": true,
  "nonce": 3
}
near-cli view orbit-anchor.testnet get_counter --networkId testnet
3
```

`paid: true` and `remitted: true` are exactly what those three transactions produced: the lot
was opened by the seller, paid by the buyer, and the proceeds remitted.

**What is deployed and what is not:** the contract implements the lot lifecycle - open, pay,
remit, plus the read methods. The full ANCHOR asset lifecycle (the compliance gate, per-lot
coupon accrual, the replay guard, the coverage check) runs in the offline engine in `src/`, and
`contract/` is the minimal on-chain registry that the lifecycle above is built on. Nothing in
this section is simulated: the four hashes above are on chain and the state above is chain
state.

## 8. Limitations

- No deployed contract and no testnet deployment (section 5).
- The coupon is simple, not compounding, and is accrued in one step per
  `accrue` call; a contract would accrue per block.
- The NAV is used for secondary transfers; redemption pays face value plus
  accrued coupon, not the NAV. A real registry would let the issuer choose.
- The compliance rules are deliberately simple: a clearance flag, a list of
  allowed jurisdictions per asset and a freeze flag. Real KYC/AML is a
  sanctions-screening service, not a boolean.
- Redemption is only allowed at maturity. Early exit would need a pricing
  rule the issuer publishes.
- `transfer` lets the buyer pay the seller directly; a real market would
  route through the pool or a settlement contract.
- The yield is **simple and non-compounding**, accrued per lot. A lot is
  created when units are subscribed or bought and is consumed oldest-first on
  a sale, so a holder's coupon is always the sum of what each lot earned while
  it was held.

## 9. Security notes

- No secrets, keys or credentials anywhere in the tree; `docs/verify.sh` checks.
- The demo and the tests make **no network calls**; `docs/verify.sh` greps for
  them and fails the tree if it finds any.
- Transfer signatures are real Ed25519 (`node:crypto`). The signed payload
  covers the seller, the buyer, the asset, the units, the price, the timestamp
  **and a per-seller nonce**, and every executed payload is remembered by
  hash - so a signature is good for exactly one transfer and cannot be
  replayed into a second one.
- The journal refuses any entry whose legs do not balance, so the book cannot
  be corrupted by a bug in a caller.
- Every action is an event in a hash chain, so the history of the registry can
  be audited and cannot be silently rewritten.

## 10. Demo material

Produced from a real run by `bash scripts/record.sh` - not written by hand:

| file | what it is |
|---|---|
| [`docs/demo-transcript.txt`](docs/demo-transcript.txt) | the real demo output |
| [`docs/demo-trace.json`](docs/demo-trace.json) | the same run as JSON: the events and the journal |
| [`docs/demo-screenshot.png`](docs/demo-screenshot.png) | a screenshot of the real transcript |
| [`docs/demo-screenshot.svg`](docs/demo-screenshot.svg) | the same as a vector image |
| [`docs/recording.txt`](docs/recording.txt) | the transcript, ready to be posted |

## 11. Licence

MIT - see [`LICENSE`](LICENSE).
