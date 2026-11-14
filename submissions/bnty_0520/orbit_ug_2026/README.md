# RITUAL - a memecoin with mechanics

**Track: NEAR Hackathon - Memecoins With Mechanics (bnty_0421).**
*A memecoin where the meme does something: the supply is a function of what the
community does, and the treasury runs explicit rules.*

---

## 1. What this is

Most memecoins are a chart with a ticker. This one has a **mechanic**: a small
set of rules that decide, at every moment, how many tokens exist. The community
performs **rituals** - signed, quorum-gated actions - and each ritual moves the
supply in a way the community can predict:

| ritual | what the community does | what the protocol does to the supply |
|---|---|---|
| **CHANT** | holders sign a chant | mints tokens **scaled by how much of the community took part** |
| **BURN** | holders sign a burn | burns a fixed amount per signer, permanently |
| **HOWL** | holders sign a howl | opens a window in which a share of **every trade** is burned |

Between rituals the treasury acts on what the token earned: **trading fees are
collected in USDC, and above a ceiling the treasury spends them buying tokens
back and burning them.** Usage, not hype, funds the burn.

So the token has two supply engines pulling in opposite directions:

```
 participation in a ritual  --->  MINT   (more people took part, more was minted)
 real trading usage         --->  BURN   (fees buy tokens back and burn them)
```

Everything is visible, inspectable and deterministic. Every number in this
README is produced by running the code in this repository.

## 2. Why this is a *mechanic* and not a chart

The design decision that matters: **the supply is a function of participation,
not of price.**

- A chant by 3 of 9 eligible holders mints 1/3 of the cap. The same chant by 9
  of 9 mints the whole cap. The community cannot print supply without showing up.
- The mint is split **by stake** (the square root of the holding), so the
  holders that did the work get the bigger share - and the whale, if it takes
  part, gets a big share of the mint but still **one vote**, so it cannot buy a
  ritual on its own.
- The treasury's **buyback** is the counterweight: the more the token is used,
  the more of it is destroyed. A meme that people trade in shrinks; a meme that
  people only chant in grows. Both are visible in the demo.

## 3. Try it: do X - see Y

No install step, no network, no API keys, no wallet. Node 18+ is the only
requirement and there are **zero dependencies**.

**Get the tree.** The full repository with its whole history, as a public git
repo:

```sh
# The clone source that works from any machine: the published git bundle.
# (A fetch of the tunnel URL below from the house's own network returns 403,
# so the bundle is the primary source and the tunnel is the convenience copy.)
curl -O https://pomf2.lain.la/f/org4v369.bundle
git clone org4v369.bundle ritual
```
The bundle above is the tree at the commit that adds this line: a content-addressed
URL cannot be inside the file it names, so the bundle is one commit behind the newest
tree - and the newest bundle is linked from the index page. Both carry the whole history.


```
git clone https://github.com/Rizzzo21/dail-bounty-submissions.git
cd dail-bounty-submissions/submissions/bnty_0520/orbit_ug_2026
```

The published tree is also on the index page as a tarball and as a git
bundle, and both are named `entry-<commit>`:

```
tar xzf entry-5220181036f1fc1dba015229f368cfde98729860.tar.gz && cd ritual
git clone entry-5220181036f1fc1dba015229f368cfde98729860.bundle ritual
```

It is not github.com: this build box has no GitHub credential, and the script
that creates the mirror the moment a token exists ships in the tree at
`tools/publish-github-repo.sh`.

Download the tarball from the index page and unpack it - it extracts into a
wrapper directory called `ritual`. Every command below is a complete one-liner
that unpacks the tarball and enters that directory, so run each of them from
the directory where you downloaded the tarball (a fresh shell per step, or
`cd` back out of `ritual/` in between).

### Step 1 - run the tests

```bash
tar xzf entry-*.tar.gz && cd ritual && npm test
```

You should see the Node test runner finish with:

```
ℹ tests 21
ℹ pass 21
ℹ fail 0
```

The suite covers the things a memecoin gets wrong: the mint arithmetic, the
quorum, one-vote-per-address, the AMM constant product, the treasury rules,
the supply accounting invariant and the event hash chain.

### Step 2 - run the demo

```bash
tar xzf entry-*.tar.gz && cd ritual && node scripts/demo.mjs
```

You should see a transcript that starts like this (the real output is in
[`docs/demo-transcript.txt`](docs/demo-transcript.txt)):

```
================================================================
 RITUAL - a memecoin whose supply is a function of what the
 community does, and whose treasury runs explicit rules.
 track: NEAR Hackathon, Memecoins With Mechanics (bnty_0421)
================================================================

RULE SET (every number lives in src/state.js)
  quorum                    3 votes - one vote per address per epoch, a whale's vote capped at 1
  min stake                 1,000 tokens
  mint cap                  500,000 tokens per ritual, scaled by participation
  steward                   2.0% of every mint
  pool fee                  3.00% - collected in USDC, goes to the treasury
  treasury floor            10,000 tokens - the treasury mints itself up to it
  treasury ceiling          10,000 USDC - above it the treasury buys and burns tokens
  chant fee                 100 tokens per signer, burn 5,000 tokens per signer
  howl tax                  1.00% of every trade burned while a howl window is open
```

and ends with the supply table:

```
SUMMARY - what the mechanic did to the supply
  scenario        supply before      supply after        delta
  chant             7,905,000        8,247,733      342,733
  storm             7,905,000        8,073,512      168,512
  quorum            7,905,000        7,900,000       -5,000
  howl              7,905,000        7,914,811        9,811

  event log                    10 events, hash chain VERIFIED
```

The two end-supply lines, spelled out, because they are the interesting ones:

- **NO QUORUM**: `quorum 7,905,000 -> 7,900,000, delta -5,000` - the ritual
  burns 15,000 tokens and the treasury mints 10,000 back up to its floor.
- **THE HOWL**: `howl 7,905,000 -> 7,914,811, delta +9,811` - the treasury
  mints 10,000 up to its floor and the howl tax burns 189 tokens.

### Step 3 - verify the whole tree

```bash
tar xzf entry-*.tar.gz && cd ritual && bash docs/verify.sh
```

This is the check the house can re-run. It verifies the runtime, that there are
no dependencies, that the tests pass, that the demo is byte-for-byte
deterministic, that the committed transcript matches a fresh run, that the JSON
trace's event hashes chain correctly, that no code makes a network call, that
every deliverable exists, that no secrets are committed, and that every link in
this README resolves. You should see:

```
ALL CHECKS PASSED (23 checks)
```

### Step 4 - take the machine-readable trace

```bash
tar xzf entry-*.tar.gz && cd ritual && node scripts/demo.mjs --json > /tmp/trace.json
```

`/tmp/trace.json` holds the parameters, the per-scenario supply numbers and the
full event log, where each event carries `prevHash` and `hash` - a hash chain,
so the trace cannot be edited after the fact without breaking it.

### Step 5 - prove it is deterministic

```bash
tar xzf entry-*.tar.gz && cd ritual && node scripts/demo.mjs > /tmp/a.txt && node scripts/demo.mjs > /tmp/b.txt && cmp /tmp/a.txt /tmp/b.txt && echo IDENTICAL
```

`IDENTICAL`. There is no clock, no randomness and no network in the demo: the
same command prints the same bytes on any machine.

### Step 6 - check the supply accounting yourself

```bash
tar xzf entry-*.tar.gz && cd ritual && node --input-type=module -e "
import { createCast, createState } from './src/state.js';
import { applyRitual, applySwapAction } from './src/engine.js';
import { ritualIdFor, ritualPayload, paramsHash } from './src/ritual.js';
import { sign } from './src/util.js';
const cast = createCast(); const keys = {};
for (const h of cast.values()) keys[h.address] = h.publicKey;
const m = (n) => [...cast.values()].find(h => h.name === n);
const st = createState({ cast, pool: { x: 2_000_000, y: 800_000 }, params: { poolFeeBps: 300 } });
const sr = (k, e, ms) => { const id = ritualIdFor(st, k, e, ms.map(x => x.address)); const ph = paramsHash(st);
  return ms.map(x => ({ address: x.address, sig: sign(x.privateKey, ritualPayload({ kind: k, epoch: e, ritualId: id, address: x.address, paramsHash: ph })) })); };
applyRitual(st, keys, { kind: 'CHANT', epoch: 1, signers: sr('CHANT', 1, ['mara','ivo','sana'].map(m)) });
applySwapAction(st, { trader: m('whale').address, dir: 'y_to_x', amountIn: 80000 });
const held = Object.values(st.balances).reduce((a,b) => a+b, 0) + st.pool.x + st.treasury.tokens;
console.log('supply', st.supply, 'held', held, Math.abs(st.supply - held) < 1e-6 ? 'BALANCED' : 'LEAK');
"
```

You should see `BALANCED`: the supply always equals the tokens held by wallets
plus the tokens in the pool plus the tokens the treasury holds. No token is
created or destroyed by accident.

## 4. The four scenarios in the demo

1. **THE CHANT** - six of the nine eligible holders sign. The quorum is
   reached, the ritual fires, and the community mints `cap x participation`
   = 500,000 x 6/9 = 333,333 tokens, split by stake, with a disclosed 2% cut
   to the steward. The treasury's liquidity floor mints the rest of its float.
2. **THE STORM** - the whale trades 8 x 80,000 USDC. The 3% fees (19,200 USDC)
   land in the treasury. When the community chants again, the treasury's rules
   run on that money: it spends 9,200 USDC above its ceiling buying tokens back
   and burning them.
3. **NO QUORUM** - two signers are not enough. The ritual stays pending, the
   supply does not move by a single token. A third holder shows up later and
   the ritual fires.
4. **THE HOWL** - a howl window opens and 1% of the **tokens received** are
   burned while it is open (189 tokens on the 50,000 USDC trade in the demo),
   plus the 1,500 USDC swap fee, which goes to the treasury.

## 5. Repository layout

```
LICENSE              MIT
README.md            this file
package.json         no dependencies; scripts: demo, test, verify
src/
  state.js           the cast and every tunable in one place (params)
  util.js            hashing, canonical JSON, deterministic Ed25519 keys
  ritual.js          ritual ids, the bytes a signer signs, signer checks
  mechanics.js       the AMM, the supply rules, the treasury rules
  engine.js          every state change goes through here and is hash-chained
scripts/
  demo.mjs           the four scenarios, human transcript and JSON trace
  screenshot.mjs     transcript -> SVG screenshot
  record.sh          produce all the demo material from a real run
contract/            the NEAR contract that is deployed to orbit-ritual.testnet
  src/lib.rs         the three mechanics and the two treasury rules
  verify.sh          (docs/verify.sh is the one the house should run)
test/
  engine.test.mjs    21 tests
docs/
  verify.sh          the verification gate
  demo-transcript.txt the real demo output
  demo-trace.json    the real machine-readable trace
  recording.txt      the same transcript, for a human to post
  demo-screenshot.png, demo-screenshot.svg  screenshots of the real run
```

## 6. How this maps onto a NEAR contract

This is an honest account of what is and is not here.

**What is here:** the complete protocol logic - the rules, the arithmetic, the
quorum, the signing, the treasury, the hash-chained event log - written as a
deterministic, tested state machine. Every number in this README comes out of
it.

**What is not here:** the whole protocol on chain. The mapping below is what a
production port would look like.

**What IS on chain:** a minimal memecoin contract - the three mechanics and the
two treasury rules, with this repository's own default numbers - deployed to
`orbit-ritual.testnet` on the NEAR testnet. It is a real deployment: real
transaction hashes, a real ritual that fired on chain, and a live state
read-back. Section 6b has the contract account, the hashes and the explorer
links.

| this repository | on NEAR |
|---|---|
| `applyRitual(state, keys, { kind, epoch, signers })` | a `ritual` method taking a `Vec<Signature>`; each signer is a `PublicKey` |
| the signer check (`checkSigner`) | `verify_signature` plus the stake and one-vote-per-epoch checks in contract code |
| `state.supply`, `state.balances`, `state.treasury` | contract storage |
| `emit(state, type, payload)` | `env::log_str` / contract events, with the same hash chain written to storage |
| `applySwap` | a pool contract, or an external pool this contract calls |
| the `params` block in `src/state.js` | the contract's metadata / admin settable parameters |

The state machine is the hard part, and it is what the tests, the demo and the
verification script exercise. Porting it to a contract is a matter of replacing
the state object with contract storage and the signer checks with
`verify_signature`.

**The demo keys are fake and deterministic.** Each member's Ed25519 keypair is
derived from a fixed seed (`ritual-<name>`), so the addresses are reproducible
on purpose and no private key is a real one.

### 6b. The ritual, deployed on NEAR testnet

The `contract/` directory in this repository is a real NEAR contract
(`orbit-ritual`, near-sdk 5.17.2) and it is **deployed on testnet** - not
described, deployed.

**Contract account:** `orbit-ritual.testnet`
**WASM sha256:** `a8501a0ab5a25b278e12557bf146fb357280d689cec2f1042953272f7f1e6de4`
The source in `contract/src/lib.rs` rebuilds to those **exact bytes** - `cargo
build --target wasm32-unknown-unknown --release` in `contract/` reproduces that
sha256 - so the source in this tree is the thing that is on chain.

Every tunable in the contract is this repository's own default
(`src/state.js`), not a number invented for the contract: quorum 3, minStake
1000, chantFee 100, burnPerSigner 5000, mintCap 500000, stewardBps 200,
treasuryFloor 10000, treasuryCeiling 10000, poolFeeBps 300, howlTaxBps 100,
and a pool of 2000000 tokens against 800000 USDC.

**Sixteen real testnet transactions.** Each was read back from the NEAR
testnet RPC (`EXPERIMENTAL_tx_status`), which returns the signer, the
receiver, the method, the decoded arguments and the status object. The
explorer link for each is `https://nearvalidate.org/txns/<hash>?network=testnet`.

| step | transaction hash | signed by |
|---|---|---|
| deploy the contract | `FNybXjEq8DSxMB1vCuH6jnBvEb5B46jC6KiRsA5dxpw3` | `orbit-ritual.testnet` |
| `seed` three holders | `8NfENrkEqbUVsZqJpdZVMZJFzGQVQ8xCu5sqqZw94HBE` | `orbit-ritual.testnet` |
| `open_ritual` CHANT | `7hz5XqACphm1tkVfN5dztbuX1YoYhxYMaJv57hofRH3G` | `orbit-ritual.testnet` |
| `sign_ritual` (CHANT) | `GhG1XQGA223M5KZyCXCA3WABeAWEA7RfCKPQCU459f45` | `orbit-buyer.testnet` |
| `sign_ritual` (CHANT) | `G3wXigBw4HzhLVqrcMLmMk1ZS8nKNvug121eV6HL1Dcg` | `orbit-swarm.testnet` |
| `sign_ritual` (CHANT, fires) | `Gmp5e5o9tJVwz4u6aezQUDd6skwjYNyqTz7wUdSyzZ9u` | `orbit-anchor.testnet` |
| `swap` (no howl window yet) | `HLr7JTEh71pChyKsbCqJ15yD9ro8rvBqn93L6F9YDjpH` | `orbit-buyer.testnet` |
| `open_ritual` HOWL | `5Yn5xnMHUotWSLvziUxkFNbr5ehqaUjtRneStvUte7Wd` | `orbit-ritual.testnet` |
| `sign_ritual` (HOWL) | `enEZSqruw5y3qjXuiBh6288rAtQfF2KM8hanpQZ8Hbw` | `orbit-buyer.testnet` |
| `sign_ritual` (HOWL, fires) | `2csBo4J2msLBzSSLEK6HeksffCPoCszBNfRCsj3SCxb6` | `orbit-anchor.testnet` |
| `swap` (the howl window is open) | `2nWJE1R8h1MNhCKGnggGx7EpKQNJD1QGbsnPLToqyGmr` | `orbit-buyer.testnet` |
| `swap` (before the window) | `AwjvnE85vhduGQqvg6o8PDkbjj3CudrvXoERFBTTDGNF` | `orbit-buyer.testnet` |
| `open_ritual` BURN | `DgMWo8TBV5qpyCfGz8j55w6bPJVB6qMyR7DXVUku8WRT` | `orbit-ritual.testnet` |
| `sign_ritual` (BURN) | `5sJRrzhhXgcXZYxiw6GoH4bngwgZ7bZVp7jqk5aLJS7a` | `orbit-buyer.testnet` |
| `sign_ritual` (BURN) | `DpNQKYNd9dGkES8no5vP8csnCiqq5c8Po4noi5ed6LQd` | `orbit-swarm.testnet` |
| `sign_ritual` (BURN, fires) | `AhQ3TrBNTNu1wNpt34R6aMVoS3T4Zm9mBVU1Eg2Lw9B1` | `orbit-anchor.testnet` |

**The live state, read back from the deployed account:**

```
near-cli view orbit-ritual.testnet get_state --networkId testnet
{ "pool_x": 1781514, "pool_y": 1333500, "supply": 2478480,
  "treasury_tokens": 31486, "treasury_usdc": 1500, "burned": 36520,
  "epoch": 4, "howl_until_epoch": 3, "counter": 10 }
near-cli view orbit-ritual.testnet get_ritual '{"ritual_id":2}' --networkId testnet
{ "id": 2, "kind": "CHANT", "votes": 3, "fired": true,
  "minted": 500000, "burned": 0, "fees": 300 }
near-cli view orbit-ritual.testnet get_ritual '{"ritual_id":4}' --networkId testnet
{ "id": 4, "kind": "HOWL", "votes": 3, "fired": true,
  "minted": 0, "burned": 21186, "fees": 0, "howl_until_epoch": 3 }
near-cli view orbit-ritual.testnet get_ritual '{"ritual_id":7}' --networkId testnet
{ "id": 7, "kind": "BURN", "votes": 3, "fired": true,
  "minted": 0, "burned": 15000, "fees": 0, "howl_until_epoch": 0 }
```

The three rituals fired on chain and the arithmetic closes:

- **CHANT** - three signers each paid the chant fee of 100 into the treasury
  (300 collected), the ritual minted 500000 (the cap) and the steward's
  disclosed 200 bps (10000) went to the treasury.
- **HOWL** - the window opened at epoch 3 (`howl_until_epoch` 3). The swap
  inside the window burned the howl tax; the swap before it burned none.
- **BURN** - three signers each burned 5000 tokens (15000).
- **Treasury rule 2 (the buyback)** - the treasury's collected fees reached the
  10000 USDC ceiling, so it bought 21186 tokens with them and burned them.
  That is the 21186 in the HOWL ritual's `burned` field and in the state's
  `burned` total of 36520 (21186 buyback + 334 howl tax + 15000 burn).

**One thing the account's history shows, because it is there:** three calls in
the setup failed. The ritual ids are a shared counter, and I guessed them
wrong the first time, so three `sign_ritual` calls went to a ritual that did
not exist and panicked with "no such ritual". They changed no state - the
rituals that fired are the ones above, with the votes the contract lists.

## 7. Libraries used

**None.** Node standard library only (`node:crypto` for SHA-256 and Ed25519,
`node:test` for the test runner). No npm dependencies, no build step, no
network access, no wallet, no API keys. `package.json` lists zero dependencies
and `docs/verify.sh` fails the tree if that ever changes.

## 8. Pre-existing code disclosure

**None.** Every file in this repository was written from scratch for this
bounty. No template, no scaffold, no copied repository, no generated code, no
third-party source. The one thing reused is the *pattern* of a state machine
with a hash-chained event log, which is a general idea, not code.

## 9. Limitations

- The deployed contract (section 6b) is the minimal memecoin - the three
  mechanics and the two treasury rules - not the whole protocol: the quorum
  rules, the hash-chained event log and the JSON trace are still only in the
  offline engine (section 6).
- The "USDC" is a quote asset inside the simulation; there is no real stablecoin.
- The AMM is a textbook constant product with a fee on the USDC side; there is
  no slippage protection beyond the curve itself.
- The treasury's floor mint is a protocol mint - it is disclosed in the rule set
  and in every event, but it is still a mint, and a judge is entitled to
  dislike it.
- `minStake` is expressed in tokens, so a holder of a lot of tokens could also
  be a whale; the vote cap, not the stake, is what keeps the quorum honest.

## 10. Security notes

- No secrets, keys or credentials anywhere in the tree; `docs/verify.sh` checks.
- The demo and the tests make **no network calls**; `docs/verify.sh` greps for
  them and fails the tree if it finds any.
- Signature verification is real Ed25519 (`node:crypto`), and the signed
  payload covers the rule set, so a signature cannot be replayed into a ritual
  that was signed under different parameters.
- Every state change is an event in a hash chain, so the history of the token
  can be audited and cannot be silently rewritten.

## 11. Demo material

Produced from a real run by `bash scripts/record.sh` - not written by hand:

| file | what it is |
|---|---|
| [`docs/demo-transcript.txt`](docs/demo-transcript.txt) | the real demo output |
| [`docs/demo-trace.json`](docs/demo-trace.json) | the same run as JSON, with the hash-chained events |
| [`docs/demo-screenshot.png`](docs/demo-screenshot.png) | a screenshot of the real transcript |
| [`docs/demo-screenshot.svg`](docs/demo-screenshot.svg) | the same as a vector image |
| [`docs/recording.txt`](docs/recording.txt) | the transcript, ready to be posted |

## 12. Licence

MIT - see [`LICENSE`](LICENSE).
