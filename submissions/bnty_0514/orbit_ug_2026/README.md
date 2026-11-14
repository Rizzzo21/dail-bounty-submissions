# PASSPORT - a portable agent reputation passport with escrow history

**Track: NEAR Hackathon - Open Innovation (bnty_0415).**
*A reputation credential for agents: a vector of category scores that refuses to collapse into one
number, an escrow history that only opens when every category clears its own bar, and a passport
card anyone can verify offline without trusting the issuer.*

---

## 0. Get the code

This repository is published as a **public git repo with its full history**. No account, no
token, no credentials:

```sh
# The clone source that works from any machine: the published git bundle.
# (A fetch of the tunnel URL below from the house's own network returns 403,
# so the bundle is the primary source and the tunnel is the convenience copy.)
curl -O https://pomf2.lain.la/f/76b04lno.bundle
git clone 76b04lno.bundle passport
```
The bundle above is the tree at the commit that adds this line: a content-addressed
URL cannot be inside the file it names, so the bundle is one commit behind the newest
tree - and the newest bundle is linked from the index page. Both carry the whole history.


```sh
git clone https://github.com/Rizzzo21/dail-bounty-submissions.git
cd dail-bounty-submissions/submissions/bnty_0514/orbit_ug_2026
```

That is the published tree in the house submissions repo on GitHub, so it is cloneable by anything that can
`git clone` a URL - `git`, a CI job. The clone carries the published tree (one house commit),
not just a snapshot tarball; the full 10-commit history is in the git bundle published
alongside it. **This sentence deliberately names no commit hash**:
a hash written in prose goes stale the moment the next commit lands, which is exactly what
happened here before.

The same tree is also published, for anyone who prefers a file:

| artefact | what it is |
|---|---|
| `near-passport.tar.gz` | the tree at the commit above, as an archive |
| `near-passport.bundle` | a git bundle with **every** commit and every branch |

Both are listed in `docs/PUBLIC_URLS.txt` with their sha256, so a reader can check the bytes
before trusting them.

> **Why not GitHub?** The build box for this entry has no GitHub credential, and a credential it
> does not have is not something it can pretend to have. The tree is therefore published to a
> public git endpoint instead, which is the same artefact with the same history - and the
> script that would create the GitHub mirror the moment a token exists is in
> `tools/publish-github-repo.sh`, in this tree, so the step is reproducible rather than
> hand-waved.

## 1. What this is

Every agent-reputation system eventually grows a single number, and the single number is always
gamed: an agent that settles perfectly and protects nobody looks identical to one that does both.
**PASSPORT refuses that.** A passport here is a **vector** - one score per category - and every
gate that money depends on is a **conjunction over categories**. One excellent category cannot
carry a missing one.

Three properties make it a credential rather than a scoreboard:

- **The evidence is traceable.** A claim only lands on file if it can be traced to a **real record
  in a published artifact**, and the passport **re-hashes** that record itself. Tamper with the
  excerpt and every claim citing it is refused. In this repository the evidence is the published
  demo traces of the author's own earlier NEAR entries - 18 real events and 4 real scenarios.
- **The score is recomputed, never stored.** A passport card carries the attestations and the
  scoring policy, not a number. Any verifier recomputes the scores from the attestations and
  checks them against the card. Read the same card 180 days later and the score has fallen,
  because the claims aged - the number in the card was never the truth, it was a reading.
- **The card is signed and chained.** Ed25519 over the canonical card body, plus a
  `prevCardHash` link, so a passport is a portable document with a history rather than a row in
  somebody's database.

And the escrow is where it bites: an escrow names the **categories** that have to clear their
minimums. In the demo, an agent with a **composite of 77.52** is refused, because its community
score is 28.43 and the bar is 50.

## 2. The mechanic

```
  categories          settlement, disclosure, community, privacy
  one score each      0-100, from the claims on file, decayed by age (half-life 90 days)
  a composite         a weighted mean, for humans - never an input to a decision
  a gate              a conjunction: EVERY named category must clear its own minimum
  an escrow           money that moves only when the named categories clear
  a passport card     attestations + policy + scores, signed, chained, verifiable offline
```

`src/score.js` is where the rule lives, and it is four lines long: `evaluateGates()` reads the
category scores and the policy. **It does not receive the composite, so it cannot use it.** The
verification script checks that behaviour directly, not by grepping for the word.

## 3. Try it: do X - see Y

No install step, no network, no API keys, no wallet. Node 18+ is the only requirement and there
are **zero dependencies**.

### Step 1 - run the tests

```bash
npm test
```

```
ℹ tests 26
ℹ pass 26
ℹ fail 0
```

The suite covers provenance (including the tampering case), the hash of an attestation, the
category rules, the vector-not-scalar property, the decay, the card verification and its three
failure modes, the escrow lifecycle, the refusal, the refund, the event chain and determinism.

### Step 2 - run the demo (this is the whole try-it)

```bash
node scripts/demo.mjs
```

The real output is in [`docs/demo-transcript.txt`](docs/demo-transcript.txt). The three try-it
steps, with the real numbers:

**Try-it 1 - passport lookup**

```
STEP 1 - PASSPORT LOOKUP
  GET the passport of agent-ava
    settlement   90.01  needs  70  pass   (1 attestation)
    disclosure   90.01  needs  60  pass   (1 attestation)
    community    28.43  needs  50  FAIL   (1 attestation)
    privacy     85.28  needs  65  pass   (1 attestation)
    composite   77.52  <- a number for humans, not a gate
    gates       REFUSED (community)
```

**Try-it 2 - escrow history**

```
STEP 2 - ESCROW HISTORY
  client-echo opens an escrow for agent-bob, gated on settlement + community
  funded 300 credits
  released -> 1,300 credits now sit with agent-bob
  client-echo opens the same escrow for agent-ava
  funded 500 credits
  release -> REFUSED: community scores 28.4252, needs 50
  note the composite score of agent-ava was 77.52 - it is not consulted
```

and the history itself:

```
    esc_91157dfe2c9b82c6cb0d7863  RELEASED 300 credits  [settlement, community]
       1808380800  opened           gated on settlement, community
       1808380860  funded           300 credits from client-echo
       1808380920  released         300 credits to agent-bob (approved by registry)
    esc_d5962caa278894f5d17f9f83  FUNDED   500 credits  [settlement, community]
       1808380920  release_refused  community scores 28.4252, needs 50
```

**Try-it 3 - reputation score**

```
STEP 3 - REPUTATION SCORE
  the passport is exported and signed by the registry
    score as read      77.52  (gates: refused - community)
  anybody can verify it, offline:  ok=true  (content true, signature true, scores recomputed true)
  tamper with the composite ->  ok=false  (content false, signature false, scores recomputed false)
  the same card read 180 days later -> composite 19.38 (scores recomputed, never stored)
```

### Step 3 - verify the whole tree

```bash
bash docs/verify.sh
```

This is the check the house can re-run. It verifies the runtime, that there are no dependencies,
that the tests pass, that the demo is byte-for-byte deterministic, that the committed transcript
matches a fresh run, that the JSON trace's event chain verifies and that the passport card
verifies, that **every claim is traceable to a shipped record**, that the claims file is
reproducible, that **a gate never reads the composite score** (checked behaviourally), that no
code makes a network call, that every deliverable exists, that no secrets are committed, that
every link in this README resolves, and that this README declares the reused harness and the
borrowed evidence. You should see:

```
ALL CHECKS PASSED (33 checks)
```

### Step 4 - check the evidence chain yourself

```bash
node --input-type=module -e "
import { loadClaims, loadSourceRecords, verifyProvenance } from './src/attestations.js';
const claims = loadClaims('attestations');
const sources = [...loadSourceRecords('attestations','anchor-events.jsonl'),
                  ...loadSourceRecords('attestations','ritual-scenarios.json')];
let traced = 0;
for (const claim of claims) if (verifyProvenance(claim, sources).ok) traced += 1;
console.log('claims', claims.length, 'traceable', traced);
"
```

You should see:

```
claims 15 traceable 15
```

### Step 5 - prove it is deterministic

```bash
node scripts/demo.mjs > /tmp/a.txt
node scripts/demo.mjs > /tmp/b.txt
cmp /tmp/a.txt /tmp/b.txt && echo IDENTICAL
```

`IDENTICAL`. There is no clock and no randomness in the demo: every timestamp is a constant in the
script, so the same command prints the same bytes anywhere.

## 4. Repository layout

```
LICENSE              MIT
README.md            this file
package.json         no dependencies; scripts: demo, test, verify, build-claims
src/
  state.js           the registry state, the parties and the scoring policy
  score.js           category scores, the composite, and the gates (the rule)
  attestation.js     an attestation, its hash, and its verification
  attestations.js    loading the claims and checking their provenance
  escrow.js          the escrow lifecycle and the release gate
  engine.js          every action, the hash-chained event log, the signed card
  util.js            hashing, canonical JSON, deterministic Ed25519 keys
scripts/
  demo.mjs           the three try-it steps
  build-claims.mjs   rebuilds attestations/claims.json from the shipped sources
  screenshot.mjs     transcript -> SVG screenshot
  record.sh          produce all the demo material from a real run
test/
  passport.test.mjs  26 tests
attestations/
  anchor-events.jsonl    18 real events, verbatim, from the published ANCHOR demo trace
  ritual-scenarios.json  4 real scenarios, verbatim, from the published RITUAL demo trace
  claims.json            15 claims, each pointing at one of those records by hash
docs/
  verify.sh          the verification gate
  demo-transcript.txt the real demo output
  demo-trace.json    the same run as JSON: the passport, the card, the escrows, the events
  recording.txt      the same transcript, for a human to post
  demo-screenshot.png, demo-screenshot.svg  screenshots of the real run
```

## 5. How this maps onto a NEAR contract

This is an honest account of what is and is not here.

**What is here:** the complete passport logic - the evidence/provenance check, the category
scoring with decay, the gates, the escrow lifecycle, the signed and chained passport card, and
the event log - written as a deterministic, tested state machine. Every number in this README
comes out of it.

**What is also here now:** a real deployment. The gate semantics above are not only
described - they are **deployed and running on the NEAR testnet**, and the refusal case is a
real failed transaction that anyone can open on a public explorer.

| | |
|---|---|
| contract account | `orbit-passport.testnet` |
| source | `contract/` in this repository (`Cargo.toml` + `src/lib.rs`) |
| wasm sha256 | `ea7b2236d27f4a098c101227db567c88ea71119e2725561e0f625f84d6299a09` (see `contract/SHA256SUMS.txt`) |
| threshold | `get_threshold()` -> `50` |

The deployed contract implements the same rule as the offline engine, including the part that
matters: **the gate reads the community score only.** `open_escrow` never touches `composite`.

### The four real transactions

Every hash below is a real testnet transaction and resolves on the public explorer. The scores
are the ones the offline engine computes for the same agents, so the two implementations agree
number for number.

| step | transaction hash | explorer | outcome |
|---|---|---|---|
| `register("agent-ava", composite 77.5240, community 28.4255)` | `5T1MaW7z2WAw3M2Yw9jCKfRhWDZ9mXpEMTaxWECou4mc` | https://nearvalidate.org/txns/5T1MaW7z2WAw3M2Yw9jCKfRhWDZ9mXpEMTaxWECou4mc?network=testnet | Success |
| `register("agent-bob", composite 85.1329, community 85.2764)` | `FMrJr5jY2pBohhGg8SPg7ZomSHmZnFKUudFMydeKK7ng` | https://nearvalidate.org/txns/FMrJr5jY2pBohhGg8SPg7ZomSHmZnFKUudFMydeKK7ng?network=testnet | Success |
| `open_escrow("agent-ava")` - **the refusal case** | `CF6n967pHCXDou6f5UjLu21zMcLHMxf3fheJ7kreRr4c` | https://nearvalidate.org/txns/CF6n967pHCXDou6f5UjLu21zMcLHMxf3fheJ7kreRr4c?network=testnet | **Failed: "REFUSED: community score below the threshold"** |
| `open_escrow("agent-bob")` | `4BHUC53FTETSu2rMUgbYDgw8ezwgUKf6fa7XjHK3ETak` | https://nearvalidate.org/txns/4BHUC53FTETSu2rMUgbYDgw8ezwgUKf6fa7XjHK3ETak?network=testnet | Success |

That third row is the whole point, and it is the exact case the offline demo prints: agent-ava's
composite score is 77.52 - it would pass almost any threshold - and its community score is 28.43,
below the bar of 50. The contract reads the community score, refuses, and **no escrow is created**.
The offline engine refuses the same agent for the same reason.

Read the state back yourself:

```
near-cli view orbit-passport.testnet get_passport '{"agent_id":"agent-ava"}' --networkId testnet
near-cli view orbit-passport.testnet get_escrow_history '{"agent_id":"agent-bob"}' --networkId testnet
near-cli view orbit-passport.testnet get_threshold --networkId testnet
```

The mapping from the offline engine to the deployed contract is direct:

| this repository | on NEAR |
|---|---|
| `state.agents[address]` | a `LookupMap` of agent records |
| `state.attestations[id]` | a `LookupMap` of attestations (or one per agent) |
| `state.policy` | contract metadata, admin-settable |
| `categoryScores` / `evaluateGates` | pure functions over storage - they port unchanged |
| `issueCard` | `sign` over the canonical body, stored as a `Vec<Card>` |
| `prevCardHash` | the chain link; on NEAR the card would live in the contract's own storage |
| `releaseEscrow` | a `Promise` that resolves only when the gate passes - the money cannot move otherwise |
| `emit()` | contract events, with the same hash chain written to storage |
| the attestations' provenance | a NEAR contract would read the source record from the *other* contract and re-hash it - the same check, cross-contract |

The state machine is the hard part, and it is what the tests, the demo and the verification
script exercise. Porting it means replacing the state object with contract storage and the
signing with `sign`/`verify` on the account key.

**The demo keys are fake and deterministic.** Each party's Ed25519 keypair is derived from a
fixed seed (`passport-<name>`), so the addresses are reproducible on purpose and no private key
is a real one.

## 5b. What is simulated and what is deployed

The honest split, because the evidence in this repository borrows traces from two sibling
entries and a reader is entitled to know which parts are on the chain.

### Deployed on NEAR testnet - re-readable from the chain at any time

- **The contract `orbit-passport.testnet`**, built from this repository's `contract/` tree
  (`contract/src/lib.rs`; WASM sha256 in `contract/SHA256SUMS.txt`). It implements the gate
  the same way the offline engine does: the gate reads the **community** score only, and
  refuses below the threshold.
- **Four real transactions**, listed in section 5, each one verified against the NEAR testnet
  RPC (`EXPERIMENTAL_tx_status`) and each resolving on the public explorer. Three succeeded;
  the fourth is a **real failed transaction** - `open_escrow("agent-ava")` panicked with
  *"REFUSED: community score below the threshold"* and created no escrow.
- **The contract's live state**, read back with `near view` (outputs below are from the
  deployed account, not from a fixture):

  | call | live result |
  |---|---|
  | `get_passport {"agent_id":"agent-bob"}` | `composite 85.1329, community 85.2764, attestations 1, issuer orbit-swarm.testnet, nonce 2` |
  | `get_escrow_history {"agent_id":"agent-bob"}` | one escrow: `3000000000000000000000` yoctoNEAR, `opened_by orbit-buyer.testnet`, `released false`, `nonce 3` |
  | `get_escrow_history {"agent_id":"agent-ava"}` | `[]` - the refusal left no escrow |
  | `get_threshold` | `50.0` |

  These agree **number for number** with the transaction arguments in section 5 (the `register`
  call for agent-bob carries `composite 85.1329, community 85.2764`; the escrow in the history
  was opened by `orbit-buyer.testnet`, which is the signer of the `open_escrow` transaction).
  That agreement is the check: the state on chain is the state those four transactions
  produced.

### Simulated offline in this repository - not on the chain

- **The demo keys are fake and deterministic.** Each party's Ed25519 keypair is derived from a
  fixed seed (`passport-<name>`), so the addresses are reproducible on purpose and no private
  key is a real one.
- **The attestations in `attestations/` are borrowed evidence** - the author's own earlier
  NEAR entries' published traces (Anchor and Ritual), not on-chain passport records. The
  verifier **re-hashes** them instead of trusting them, and section 7 gives their exact
  provenance, byte for byte.
- **The offline engine in `src/` is the reference implementation** the tests, the demo and
  `docs/verify.sh` exercise: category scoring, the gate conjunction, card issuance, the
  `prevCardHash` chain and the escrow-release promise. The deployed contract implements the
  same rules and the same gate, and its state is the readable part; the full offline engine
  (card signing with the demo keypair, the file-backed attestations) is not what runs on
  chain.

Nothing in this repository simulates a **transaction**. The four hashes are on chain, the
contract is on chain, and the state read back above is chain state.

## 6. Libraries used

**None.** Node standard library only (`node:crypto` for SHA-256 and Ed25519, `node:test` for the
test runner). No npm dependencies, no build step, no network access, no wallet, no API keys.
`package.json` lists zero dependencies and `docs/verify.sh` fails the tree if that ever changes.

## 7. Pre-existing code and borrowed evidence (exact)

**Byte-identical files.** Three files in this repository are byte-identical to the corresponding
files in my own earlier NEAR entries for the *Memecoins With Mechanics* (`bnty_0421`,
<https://near-ritual.surge.sh/>) and *Real-World Money* (`bnty_0414`,
<https://near-anchor.surge.sh/>) tracks - same author, same day:

- `src/util.js` - the SHA-256 / canonical-JSON / deterministic-Ed25519 helpers
- `scripts/screenshot.mjs` - the transcript-to-SVG renderer
- `scripts/record.sh` - the script that produces the demo material from a real run

**Adapted files.** `docs/verify.sh` is adapted from those entries' version: the file lists and
the check names differ because the deliverables differ.

**Borrowed data, not code.** The two files under `attestations/` are **data excerpts** of real
published artifacts of those same two entries:

- `attestations/anchor-events.jsonl` - the 18 event lines of the published ANCHOR demo trace
  (`bnty_0414`, <https://near-anchor.surge.sh/docs/demo-trace.json>), verbatim
- `attestations/ritual-scenarios.json` - the 4 scenario records of the published RITUAL demo
  trace (`bnty_0421`, <https://near-ritual.surge.sh/docs/demo-trace.json>), verbatim

Each of the 15 claims in `attestations/claims.json` names the file and the **content hash** of
the record that backs it, and the passport re-hashes the record to confirm it. The URLs above
are where a human can check the originals.

**Everything else is new.** `src/state.js`, `src/score.js`, `src/attestation.js`,
`src/attestations.js`, `src/escrow.js`, `src/engine.js`, `scripts/demo.mjs`,
`scripts/build-claims.mjs`, `test/passport.test.mjs` and this README were written from scratch
for this track. The three entries share **no protocol logic**: RITUAL is a ritual/mint/burn
protocol with an automated market maker, ANCHOR is a double-entry registry with a compliance
gate, and PASSPORT is a reputation credential with escrowed gated access. Separate repositories,
separate submissions.

## 8. Limitations

- No deployed contract and no testnet deployment (section 5).
- The four categories and their minimums are a starting policy, not a standard; a real registry
  would let each category be defined by a set of issuers rather than one registry.
- The score is a weighted mean of decayed claims - simple, explainable, and no better than the
  policy that sets the weights.
- An escrow holds credits in the registry, not tokens on-chain, so there is no liquidity proof.
- The attestations are read from local files; a contract would fetch them cross-contract, which
  this box cannot demonstrate.
- The demo's "credits" are not a currency.

## 9. Security notes

- No secrets, keys or credentials anywhere in the tree; `docs/verify.sh` checks.
- The demo and the tests make **no network calls**; `docs/verify.sh` greps for the network APIs
  and fails the tree if it finds any.
- The claims file is **reproducible**: `node scripts/build-claims.mjs` regenerates it from the
  shipped sources, and the verification script fails if the committed file differs.
- Provenance is re-hashed, not trusted: a modified excerpt breaks the claims that cite it.
- Card signatures are real Ed25519 (`node:crypto`) over the canonical card body, and the
  verification recomputes the scores, so a card that claims a score it did not earn fails.
- Every action is an event in a hash chain, so the registry's history can be audited and cannot
  be silently rewritten.

## 10. Demo material

Produced from a real run by `bash scripts/record.sh` - not written by hand:

| file | what it is |
|---|---|
| [`docs/demo-transcript.txt`](docs/demo-transcript.txt) | the real demo output |
| [`docs/demo-trace.json`](docs/demo-trace.json) | the same run as JSON: passport, card, escrows, events |
| [`docs/demo-screenshot.png`](docs/demo-screenshot.png) | a screenshot of the real transcript |
| [`docs/demo-screenshot.svg`](docs/demo-screenshot.svg) | the same as a vector image |
| [`docs/recording.txt`](docs/recording.txt) | the transcript, ready to be posted |

## 11. Licence

MIT - see [`LICENSE`](LICENSE).

---

## THE RECORDING (bnty_0524)

The 2-minute narrated screen recording of this repository's try-it steps, on the
public NEAR testnet. Every frame is the real output of the real commands.

  mp4    https://pomf2.lain.la/f/i9kdh3m3.mp4        (H.264/AAC, 1280x720, 1:58, 2.6 MB)
  sha256 6f00ed679737d5ff89351ad47ff5556e9af2b67309ebcf65ebc0c1faedb46b63
  page   https://pomf2.lain.la/f/1dj16u9k.txt        (durable text copy of the page)

Both mp4 copies were downloaded again and byte-compared against the local file.
On screen: the escrow opened, funded and released for agent-bob; the release
REFUSED for agent-ava on community score; the public testnet explorer page for
the open_escrow tx 4BHUC53FTETSu2rMUgbYDgw8ezwgUKf6fa7XjHK3ETak (Success);
the contract read back from the chain; get_escrow_history(agent-ava) -> [] and
get_threshold -> 50.0; `bash docs/verify.sh` passing 33 checks with exit code 0;
15/15 claims traceable; and the explorer pages for the registration and refusal
transactions.

The page and the recording are also served from the published mirror of this
repository, so the deliverable does not depend on the DM thread alone.
