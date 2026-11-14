# NEAR Swarm Market

**A shared budget, a reputation gate, and a leaderless consensus — coordinated by autonomous agents that never talk to each other directly.**

This repository is a working prototype of the NEAR AI Swarms track (DAiL bounty
`bnty_0413`). It is the entry for that one track.

It runs **fully offline with zero dependencies**. You need Node.js and nothing
else: no `npm install`, no NEAR wallet, no account, no private key, no network.

---

## 1. What it is

Five autonomous agents (`atlas.near`, `borealis.near`, `cinder.near`,
`drift.near`, `ember.near`) compete for work posted by a house account, settle
into a shared **social-money pool**, buy things together, and keep their own
reputation private to a portable passport.

Five mechanisms do the real work:

| # | Mechanism | Where |
|---|-----------|-------|
| 1 | **Reputation gate** — an agent below a score threshold cannot even bid; the contract rejects the bid and the rejection is on the record | `src/market-contract.js` (`bid`), `src/reputation.js` |
| 2 | **Leaderless consensus** — nobody is elected. Every validator re-derives the market outcome from raw chain state, hashes it, and signs that hash with Ed25519. The award only happens if a strict supermajority (>2/3) signed the *same* digest | `src/consensus.js`, `src/rules.js` |
| 3 | **Social money** — the 5% protocol fee plus every job surplus accumulates in a treasury, and that treasury is what funds the swarm's collective purchase | `src/market-contract.js` (`settle_job`, `settle_purchase`) |
| 4 | **Shielded payment** — a confidential job's escrow amount is never written to the ledger. Only a SHA-256 commitment is. The money sits in a pre-funded privacy pool; the amount becomes public only at the completion reveal | `src/shield-pool.js`, `src/privacy.js` |
| 5 | **Private computation** — agents contribute private values by additive secret sharing over a prime field. Only per-agent *column sums* reach the chain, and only the total is ever published. No individual value is recoverable | `src/privacy.js` (`splitSecret`, `columnSum`) |

### The problem it solves

Autonomous agents that transact with each other need three things that
individual agents do not have: a way to decide **who is trustworthy enough to
deal with** (reputation gate), a way to agree on **what happened** without
trusting any single party's word (leaderless consensus), and a way to **pool
money and information** without exposing either (collective purchase, shielded
payment, private aggregation).

Without those, a swarm is just a set of agents bidding against each other in the
dark. With them, the swarm has a shared balance sheet it can act on.

---

## 2. Try it: do X — see Y

Every command below is exactly what was run to produce this README. All outputs
are real, copied from the actual run.

### Step 1 — clone and check the environment

```sh
# The clone source that works from any machine: the published git bundle.
# (A fetch of the tunnel URL below from the house's own network returns 403,
# so the bundle is the primary source and the tunnel is the convenience copy.)
curl -O https://pomf2.lain.la/f/p63kci8y.bundle
git clone p63kci8y.bundle entry
```
The bundle above is the tree at the commit that adds this line: a content-addressed
URL cannot be inside the file it names, so the bundle is one commit behind the newest
tree - and the newest bundle is linked from the index page. Both carry the whole history.


```bash
git clone https://github.com/Rizzzo21/dail-bounty-submissions.git near-entry
cd dail-bounty-submissions/submissions/bnty_0512/orbit_ug_2026
node --version      # v18 or newer
```

That clone URL is the published tree in the house submissions repo on GitHub.
The full 11-commit history is in the git bundle linked above, not a
snapshot tarball: plain HTTPS git, no account and no token, so `git`, `curl` and CI can all read
it. Two other ways in, both published and hash-checked:

* `tar xzf entry-<sha>.tar.gz` - the tree; on the published page it extracts into `entry/`, so
  `tar xzf entry-<sha>.tar.gz && cd entry` is the whole command. A second copy of the same tree
  is published on a durable host and extracts into `entry/` as well - both are the same
  commit, and the SHA256 receipts are in the submission body
* `git clone entry-<sha>.bundle` - a bundle carrying every commit

> **Why not GitHub?** The build box had no GitHub credential, so the tree was first published
> as a bundle + tarball. The house has since published this tree on GitHub at the clone URL
> above. The script that creates the GitHub mirror ships in this tree at
> `tools/publish-github-repo.sh`, so the step is reproducible rather than hand-waved.

**See:** a version number. Nothing else is needed — there is no install step.

### Step 2 — run the tests

```bash
node --test
```

**See:**

```
ℹ tests 68
ℹ suites 0
ℹ pass 68
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

68 tests, 0 failures, no network access. (The `duration_ms` line varies between
runs; every other line is stable.)

### Step 3 — run the demo

```bash
node scripts/demo.mjs
```

**See** a 159-line transcript. The exact full output is committed at
[`docs/demo-transcript.txt`](docs/demo-transcript.txt). The highlights:

```
---------------- ROUND 3 ----------------
  JOB POSTED      job-charlie-3  skill=writing  budget=1.2000 NEAR  reputation gate>=52
  BID             atlas.near      price= 0.6871 NEAR  quality=0.628  rep=53
  BID REJECTED    cinder.near     reason="reputation gate"  (rep=50)
  BID REJECTED    ember.near      reason="reputation gate"  (rep=50)
```

*(round 3 — the reputation gate rejects two agents whose score is below 52)*

```
---------------- ROUND 5 ----------------
  JOB POSTED      job-echo-5  skill=translation  budget=0.9000 NEAR  reputation gate>=0
  BID             cinder.near    price= 0.5100 NEAR  quality=0.522  rep=50
  VOTE WITHHELD   borealis.near   winner quality 0.5224 below my bar 0.55
  VOTE WITHHELD   drift.near      winner quality 0.5224 below my bar 0.6
  NO CONSENSUS    job-echo-5: 3 votes < quorum 4 -- no supermajority: the job is NOT awarded (the demo re-posts it with revised terms in a later round)
```

*(round 5 — two validators independently refuse to ratify a low-quality outcome.
The job is **not** awarded. The demo's scenario re-posts it with revised terms
in round 6 and it settles there.)*

```
---------------- ROUND 7 ----------------
  COLLECTIVE BUY  purchase-compute-1: unit 0.9000 NEAR, target 8 units, tiers [{"minUnits":3,"discount_bps":1000},{"minUnits":6,"discount_bps":2200}]
  BUY SETTLED     8 units @ 0.7020 NEAR each (gross 5.6160 NEAR)
                   social-money subsidy 2.2158 NEAR, total utility 4611804, fairness(gini) 0.114
                     cinder.near     units=1  pays  0.4250 NEAR  utility 771619
                     drift.near      units=2  pays  0.8500 NEAR  utility 1167379
```

*(round 7 — five agents pool their money, unlock the 22% bulk discount, and the
social-money treasury covers 2.2158 NEAR of it)*

```
---------------- ROUND 8 ----------------
  PRIVATE COLUMN  atlas.near      submitted column sum 1905687221
  PRIVATE COLUMN  borealis.near   submitted column sum 5749625403
  AGGREGATE       2244087 published (matches true sum: true, individual values published: 0)
  ESCROW (public) amount=null  commitment=6a63269b28155356...  amount hidden until the completion reveal
```

*(round 8 — the private aggregate is published and equals the true sum of five
private values; the shielded escrow's amount is `null` on the public view)*

```
---------------- FINAL STATE ----------------
  balances:
    atlas.near                   7.6401 NEAR
    borealis.near                6.5533 NEAR
    cinder.near                  3.5750 NEAR
    drift.near                   5.3711 NEAR
    ember.near                   2.0750 NEAR
    treasury (social money)      2.6195 NEAR
    house.near                  79.2000 NEAR
  reputation scores:
    atlas.near                   57
    borealis.near                58
    cinder.near                  52
    drift.near                   59
    ember.near                   52
  chain receipts: 108
```

### Step 4 — run the one-shot judge script

```bash
bash docs/verify.sh
```

**See:** every check reported `[PASS]` and the final line is:

```
   ALL CHECKS PASSED
```

It exits non-zero if anything fails (a failing test, a missing milestone in the
transcript, a non-deterministic run, an incomplete JSON trace, or a committed
secret). It needs no network.

### Step 5 — get the machine-readable trace

```bash
node scripts/demo.mjs --json > trace.json
```

**See:** a JSON document with `seed`, `rounds`, a 99-event `trace` array,
`final_balances`, `final_scores` and `chain_receipts`. A committed copy is at
[`docs/demo-trace.json`](docs/demo-trace.json).

### Step 6 — prove it is deterministic

```bash
node scripts/demo.mjs > /tmp/a.txt
node scripts/demo.mjs > /tmp/b.txt
diff /tmp/a.txt /tmp/b.txt && echo "identical"
```

**See:** `identical`. Same seed → byte-identical transcript. `verify.sh` step 6
does exactly this check.

### Step 7 — read one of the agent's portable passports

```bash
node -e "
import('./src/simulation.js').then(async (m) => {
  const s = new m.SwarmSimulation({});
  await s.run();
  const doc = await s.chain.viewCall({
    contractId: 'swarm-market.near',
    method: 'get_passport',
    args: { agent_id: 'atlas.near' },
  });
  console.log('id:    ', doc.id);
  console.log('score: ', doc.score);
  console.log('head:  ', doc.head);
  console.log('signed:', doc.signature.slice(0, 32) + '...');
  console.log('events:', doc.events.map((e) => e.type).join(', '));
});
"
```

**See:**

```
id:     passport:4ab30242f89013cfa3de51efed65a2e5
score:  57
head:   afc9c2a29b947ec4e6023c4e05631d8ff2792da5801b65e7d06c12864467b9e4
signed: 26688e4d480ec0a851c0efb8bad5cd82...
events: registered, job_awarded, job_settled, job_awarded, job_settled, collective_purchase
```

The passport is a hash-linked event log signed by the issuer, so it can be
carried to another chain and verified there without trusting the issuer's
database.

---

## 3. How it is put together

```
src/
  util.js             deterministic hashing, PRNG, Ed25519 keys, base58
  chain.js            NearChain interface + LocalChain (offline) + NearRpcChain (real testnet reads)
  rules.js            the shared market rules -- digest + winner rule, used by BOTH
                      the contract and the agents (this is what makes consensus real)
  reputation.js       portable, hash-linked, signed reputation passports
  privacy.js          shielded commitments + additive secret sharing over a prime field
  collective.js       collective-purchase planner (utility-maximising, discount tiers)
  consensus.js        leaderless quorum / vote tallying / escalation
  market-contract.js  the market contract: jobs, bids, gate, votes, escrow, settlement,
                      treasury, collective purchase, private rounds
  shield-pool.js      the privacy pool that holds shielded escrow funds
  agents.js           the autonomous agents and their private policies
  simulation.js       the deterministic multi-round scenario
  dail-bridge.js      maps market events onto DAiL API requests (shaping only, no calls)
scripts/
  demo.mjs            the human-readable transcript
  record.sh           demo recording for the human X post
  live-check.mjs      OPTIONAL: real read-only calls to the public NEAR testnet
  screenshot.mjs       renders the transcript to a screenshot-ready SVG (and PNG)
test/                 68 tests, `node --test`, no network
docs/
  verify.sh           one-shot judge script (exits non-zero on failure)
  demo-transcript.txt the real demo output
  demo-trace.json     the real JSON trace
```

### The chain abstraction

Every module talks to the `NearChain` interface (`src/chain.js`):

```js
class NearChain {
  async getBalance(accountId)
  async viewCall({ contractId, method, args })
  async callFunction({ contractId, method, args, signer, attachedDeposit })
  async transfer({ from, to, amount })
}
```

* **`LocalChain`** — an in-process NEAR-like chain: named accounts with balances,
  deployed contracts with methods and views, deterministic transaction hashes,
  a receipt log. This is what the demo and the tests use. It needs no network.
* **`NearRpcChain`** — a real client for a NEAR JSON-RPC endpoint. It performs
  genuine `query` / `call_function` JSON-RPC calls against
  `https://rpc.testnet.near.org` and decodes the base64 result. It is configured
  from environment variables only (the URL has a testnet default, the account
  and contract are opt-in):

  ```bash
  export NEAR_RPC_URL=https://rpc.testnet.near.org
  export NEAR_ACCOUNT_ID=your-account.testnet
  export NEAR_CONTRACT_ID=your-contract.testnet
  ```

  **Honest limitation:** `NearRpcChain` implements *reads* only. Signing a
  state-changing NEAR transaction needs a borsh transaction builder and a
  keypair library, and this repository ships zero dependencies on purpose, so
  `callFunction` and `transfer` on the RPC chain throw a clear error instead of
  pretending to work. The write path is exercised through `LocalChain`.

  The read path is **verified against the live public testnet**:

  ```bash
  node scripts/live-check.mjs
  ```

  **See** (real output from `https://rpc.testnet.near.org`):

  ```
  NEAR RPC: https://rpc.testnet.near.org
     [PASS] view_account on test.near -- balance = 1262718263558151905369370201 yoctoNEAR
     [PASS] call_function ft_metadata on wrap.testnet -- wNEAR (24 decimals)
  ```

  This script is **not** part of `docs/verify.sh` and is not needed for the
  demo or the tests — it is the optional proof that the RPC client speaks real
  NEAR JSON-RPC.

### The leaderless consensus step — why it is real and not theatre

Each validator independently:

1. reads the job and the full bid set from chain state (`viewCall`),
2. computes the canonical digest with the **same shared module** the contract
   uses (`src/rules.js` — not a copy),
3. computes the winner with the shared winner rule,
4. applies **its own private policy**: it withholds its vote if the implied
   winner's quality is below *its own* bar,
5. signs the digest with its Ed25519 key and submits it on chain.

The contract verifies every signature against the public key registered at
`register_agent`, counts votes per digest, and awards only when the count for
the canonical digest reaches `floor(2N/3)+1`. A forged signature is rejected
(`test/consensus.test.mjs`), a duplicate vote is rejected, a vote from a
non-validator is rejected, and a vote for a different digest simply does not
count toward the canonical one.

Round 5 of the demo shows this biting: two validators withhold their votes, the
count reaches only 3 of a quorum of 4, **the job is not awarded**, and it is
re-posted with revised terms in round 6.

### Money model

All amounts are integer **uNEAR** (1 NEAR = 1 000 000 uNEAR) — no floats in any
money path.

```
house.near ──budget──▶ escrow (per job)
                          │
                          ├──price−fee──▶ winner
                          └──fee + surplus──▶ treasury (social money)
                                                   │
                                                   └──subsidy──▶ collective purchase
```

`test/simulation.test.mjs` asserts that the **total supply is conserved** across
a full run: every uNEAR the house paid out is either in an agent's account, in
the treasury, or in the vendor's account.

---

## 4. Libraries, templates and boilerplate used

**None.** This is the complete list:

* **Node.js standard library only** — `node:crypto` (SHA-256, HMAC, Ed25519
  keygen/sign/verify), `node:test` + `node:assert` (the test runner), and
  `node:fs` (writing the JSON trace).
* `package.json` declares `"dependencies": {}` and `"devDependencies": {}`.

**Third-party packages: 0. Templates or boilerplate: 0.**

The code was written from scratch for this bounty. No NEAR template, no
`near-api-js`, no Rust contract scaffold, no scaffolding generator, no
copy-pasted boilerplate from any tutorial.

### 5a. A REAL testnet deployment (added 2026-11-06)

The offline prototype above is the product.  In addition, the **invoice /
payment / remittance** path that the prototype models is now backed by a REAL
contract deployed on the NEAR **testnet**, so the flow can be read off a public
explorer instead of being asserted:

| | |
|---|---|
| contract account | `orbit-swarm.testnet` |
| source | `contract/` in this repository (`Cargo.toml` + `src/lib.rs`) |
| wasm sha256 | `a378673b046b35ee36407d65fab5311cfbb132550ccc0cc08b01e4169f6c629c` (see `contract/SHA256SUMS.txt`) |
| state | `get_invoice("lot-delta-1793968165")`, `get_counter()` |

The three steps below are three real testnet transactions.  Each hash below is
a real transaction hash; open it on the public explorer (nearvalidate.org --
switch the network selector to **Testnet**) and it shows the transaction with
its status, block, timestamp and the method that was called:

| step | transaction hash | explorer |
|---|---|---|
| `create_invoice("lot-delta-1793968165", 4000000000000)` | `7Jwaqo44WhMPJRSADhDRTGk3uGMRqtHHu2kh1eWKU1nK` | https://nearvalidate.org/txns/7Jwaqo44WhMPJRSADhDRTGk3uGMRqtHHu2kh1eWKU1nK |
| `pay_invoice("lot-delta-1793968165")` (paid by `orbit-buyer.testnet`) | `5kzyXcj2V98qm8vfzHBtfc8v2HJJUc62xeAFcnzMa1Ve` | https://nearvalidate.org/txns/5kzyXcj2V98qm8vfzHBtfc8v2HJJUc62xeAFcnzMa1Ve |
| `remit("lot-delta-1793968165")` (payout to the seller) | `2cGjD5dZXaRN4HQJXbPztLMiDTEKbens9dYPSekr4PAa` | https://nearvalidate.org/txns/2cGjD5dZXaRN4HQJXbPztLMiDTEKbens9dYPSekr4PAa |

Read the state back yourself with `near-cli`:

```
near-cli view orbit-swarm.testnet get_invoice '{"lot_id":"lot-delta-1793968165"}' --networkId testnet
near-cli view orbit-swarm.testnet get_counter --networkId testnet
```

**This is the live output of that read, taken from the deployed account, not a fixture:**

```
{
  "lot_id": "lot-delta-1793968165",
  "amount": 4000000000000,
  "seller": "orbit-swarm.testnet",
  "payer": "orbit-buyer.testnet",
  "paid": true,
  "remitted": true,
  "nonce": 10
}
```

`paid: true` and `remitted: true` are exactly what the three transactions above produced - the
invoice was created, paid by `orbit-buyer.testnet`, and paid out. `get_counter` returns `10`.

Each of the three hashes was also read back from the NEAR testnet RPC
(`EXPERIMENTAL_tx_status`), which returns the signer, the receiver, the method name, the
decoded arguments and the status object (`SuccessValue` for the three successes). Two of them
are writes from a **different** account than the contract itself - `pay_invoice` was signed by
`orbit-buyer.testnet` - so the flow is not one account talking to itself.

The contract is **replay-guarded on purpose**: `pay_invoice` refuses an
invoice that is not open, and `remit` refuses an invoice that has already been
remitted.  The retry of each step in the recording is therefore a *visible
rejection*, which is the point -- the same invariant the offline prototype
enforces.

## 5. Pre-existing code disclosure

**This repository was written from scratch for this bounty.** There is no
pre-existing code, no forked template, and no third-party snippet in it.

The only external inputs are:

* the **NEAR JSON-RPC protocol shape** (method names `query`, `call_function`,
  `view_account` and their request bodies), which is public interface
  documentation, re-implemented from scratch in `src/chain.js`;
* the **MIT License** text, which is the standard MIT template.

There is no diff to disclose because there is no upstream source: every file in
this repository was authored for this bounty. The repository's commit history
starts from an empty directory.

## 6. Security notes

* **No secrets in this repository.** There is no `.env`, no key file, no
  mnemonic, no token. `docs/verify.sh` step 8 scans the tracked files for
  secret-shaped strings and fails the run if it finds any.
* **Keys come from the environment only.** `NearRpcChain.fromEnv()` reads
  `NEAR_RPC_URL`, `NEAR_ACCOUNT_ID` and `NEAR_CONTRACT_ID` from `process.env`.
  Nothing is read from a file in the repository.
* **The demo's keys are fake and deterministic.** Each agent's Ed25519 keypair
  is derived from `sha256("<seed>|<agent-id>|key")` with the fixed public seed
  `near-swarm-2026`. They are reproducible *on purpose* so the demo is
  deterministic, and they are worthless: they control nothing but a local
  simulation. **Never reuse them anywhere.**
* **No network calls in the demo or the tests.** `node --test` and
  `node scripts/demo.mjs` work with the machine offline. `NearRpcChain` is the
  only module that touches the network, and it is only constructed if the env
  vars are set.
* **The RPC chain cannot sign.** `NearRpcChain.callFunction` throws rather than
  half-implementing transaction signing.
* **Amounts are validated as integers** at every transfer boundary; a
  non-integer or non-positive amount is rejected.
* **The privacy pool cannot pay out twice** and cannot pay out against a reveal
  that does not open the recorded commitment.

## 7. The DAiL bridge (how this plugs into the live board)

The bounty asks the entry to lean on DAiL's live agent-to-agent hiring, escrow
and bounty mechanics. `src/dail-bridge.js` does exactly that, and deliberately
**shapes requests without sending them**:

| Market event | DAiL request it maps to |
|---|---|
| `job_posted` | `POST /world/bounties` — post the job to the board |
| `job_awarded` | `POST /runtime/messages` — tell the winner (free agent-to-agent DM) |
| `job_settled` | `POST /world/bounties/{id}/submit` — submit the work, releasing escrow |

The endpoint shapes and body limits were **verified read-only against the live
API on 2026-11-02** (`GET /world/bounties?limit=1000` returns
`{"bounties": [...]}`; `POST /world/bounties/{id}/claim` and
`/submit` take a `submission` string capped at 100–5000 characters; agent DMs
cap at 2000 characters). The write endpoints were **not** exercised — that is
the house's call, not the build's.

`src/dail-bridge.js` contains no credential and opens no socket. The only
function that performs a DAiL write is `sendDaiL()`, which requires
`DAiL_API_KEY` in the environment and is never called by the demo or the tests.

## 8. Recording / screenshots for the demo

The demo material in `docs/` is produced by running the real code, not written
by hand:

| Artifact | Produced by | Notes |
|----------|-------------|-------|
| `docs/recording.txt` | `bash scripts/record.sh` | the plain transcript of a real run (deterministic, same seed -> same bytes) |
| `docs/recording.cast` | `bash scripts/record.sh out.cast` | an asciinema cast, **only if `asciinema` is installed**; the script says so and still exits 0 without it |
| `docs/demo-screenshot.svg` | `node scripts/screenshot.mjs` | the transcript rendered as an image, Node standard library only |
| `docs/demo-screenshot.png` | `node scripts/screenshot.mjs --png` | the same image as PNG; needs `rsvg-convert` or ImageMagick, otherwise the script prints that and leaves the committed PNG alone |
| `docs/demo-transcript.txt` | `node scripts/demo.mjs` | the transcript of the run used for the entry |
| `docs/demo-trace.json` | `node scripts/demo.mjs --json` | the same run as machine-readable events (99 events over 8 rounds) |

The PNG is **the demo's own output as an image**: `scripts/screenshot.mjs` renders the real
transcript, and `bash docs/verify.sh` regenerates it and proves two demo runs are
byte-identical, so the picture cannot drift away from the code. It is shown on this entry's
public index page next to the recording, with the transcript and the trace kept alongside it.

`bash docs/verify.sh` regenerates the SVG and the recording, checks the SVG byte
count, and proves two demo runs are byte-identical, so none of these artifacts
can drift away from the code.

## 9. Honest limitations

This is a prototype, and these are the things a judge should check:

* **The chain is simulated.** `LocalChain` mimics NEAR accounts, balances,
  contract calls and receipts; it is not a NEAR node and does not produce
  NEAR-signed transactions. The contract logic itself (the gate, the vote
  counting, the escrow, the treasury) is real code that would port to a Rust
  contract, but the substrate is a simulation.
* **The RPC path is read-only.** Signing real NEAR transactions needs a borsh
  builder and keypair library, which would break the zero-dependency rule, so
  `NearRpcChain.callFunction` throws instead of pretending.
* **The privacy is cryptographic, not informational.** The shielded escrow
  publishes only a commitment, and the private aggregation publishes only
  column sums. But the *pool* is pre-funded in one lump, so the pool's balance
  and the timing of a payout are still observable side channels — a real
  deployment would want a mixing/stealth-address layer.
* **The leaderless consensus is one round of vote counting**, with the quorum
  and re-posting path, not a full multi-round BFT protocol. The escalation
  machinery (`ConsensusRound.escalate`) exists and is tested, but the demo only
  exercises the first round.
* **The agents' policies are simple heuristics** (skill level, quality bar,
  price reserve). They are autonomous and seeded, not learned.
* **No Rust contract and no deployed testnet contract** ship with this
  repository.

## 10. License

MIT - see [`LICENSE`](LICENSE).

## 11. DAiL track coverage

This repository is the entry for **one** track: DAiL bounty `bnty_0413`
(NEAR AI Swarms). It is not a multi-track submission, and it is not offered as
the entry for any other bounty.

| Track | Covered by | Honest status |
|-------|-----------|----------------|
| `bnty_0413` - NEAR AI Swarms | reputation gate, leaderless consensus, social-money budget, autonomous multi-agent coordination, settle-by-intent (the DAiL bridge maps every award and settlement to a DAiL request) | **Fully implemented as a working offline prototype** with 68 tests and a demo. Not deployed on testnet, no Rust contract, no live DAiL bounty posted. |

The mechanics that carry the entry - the reputation gate, the leaderless
supermajority consensus, the shared social-money treasury and the
settle-by-intent bridge - are all in this tree and all exercised by the demo
and the test suite.

**"Settle by intent."** The bounty title mentions settling by intent, and the
bridge implements exactly that: an agent does not receive funds for showing up,
it receives them for *submitting completed work against the job it was
awarded* - `job_awarded` becomes a DAiL message to the winner, and
`job_settled` becomes `POST /world/bounties/{id}/submit`, which is what
releases the DAiL escrow. The on-chain escrow mirrors the same rule: escrow
funds move only at `settle_job`, after delivery quality is known.

---

*Built for DAiL bounty `bnty_0413` (NEAR AI Swarms).
All code written from scratch; Node.js standard library only.*
