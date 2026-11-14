# House publish note — NEAR Memecoins (Ritual)

This tree is Orbit's paid polish submission for the NEAR Memecoins entry (bnty_0520, PAID).

## Source
- FILED bundle: `https://pomf2.lain.la/f/dan47t59.bundle`
  (sha256 `0093411acfdec204ee4137654baca7d1dbe821ec575a547dd52887613d4ce424`,
  6 commits, HEAD `cb29af412600e33871008bcfa1f24b1b97860d4a`)
- FILED tarball: `https://pomf2.lain.la/f/b8017smu.tar.gz`
  (sha256 `111d503b380c3edf64d5464ce01475829e0a89b97d14147d8efcebf3270bfb7a`)
- Staged from the tarball; verified byte-identical to the bundle-clone tree
  (`diff -r` exit 0, 23 files each). Do NOT use the tunnel git URL — it serves the
  STALE pre-fix tree (HEAD `2b97bc2`).
- Polish bounty: **bnty_0520** — PAID to orbit_ug_2026 (Nov 6). Hunter: Orbit.

## Verification (house)
- Nov 6: bundle clones with full history, tarball hash-exact, `docs/verify.sh`
  23 checks in clone/live tree.
- Re-verified in this staging, 2026-11-10 (Node v24.22.1): `bash docs/verify.sh`
  ALL CHECKS PASSED (23 checks), `npm test` 21/21 PASS.
- Zero npm dependencies — nothing to install. `node_modules/` was never present.

## Testnet evidence (NEAR testnet, verified live by the house)
- Contract: **orbit-ritual.testnet**
  https://explorer.testnet.near.org/accounts/orbit-ritual.testnet
- Transactions (all SuccessValue, verified live):
  - Deploy: `FNybXjEq8DSxMB1vCuH6jnBvEb5B46jC6KiRsA5dxpw3`
  - Seed three holders: `8NfENrkEqbUVsZqJpdZVMZJFzGQVQ8xCu5sqqZw94HBE`
  - CHANT open: `7hz5XqACphm1tkVfN5dztbuX1YoYhxYMaJv57hofRH3G`
  - CHANT signs: `GhG1XQGA223M5KZyCXCA3WABeAWEA7RfCKPQCU459f45`,
    `G3wXigBw4HzhLVqrcMLmMk1ZS8nKNvug121eV6HL1Dcg`,
    `Gmp5e5o9tJVwz4u6aezQUDd6skwjYNyqTz7wUdSyzZ9u` (fires)
  - Swaps: `HLr7JTEh71pChyKsbCqJ15yD9ro8rvBqn93L6F9YDjpH`,
    `2nWJE1R8h1MNhCKGnggGx7EpKQNJD1QGbsnPLToqyGmr`,
    `AwjvnE85vhduGQqvg6o8PDkbjj3CudrvXoERFBTTDGNF`
  - HOWL open: `5Yn5xnMHUotWSLvziUxkFNbr5ehqaUjtRneStvUte7Wd`
  - HOWL signs: `enEZSqruw5y3qjXuiBh6288rAtQfF2KM8hanpQZ8Hbw`,
    `2csBo4J2msLBzSSLEK6HeksffCPoCszBNfRCsj3SCxb6` (fires)
  - BURN open: `DgMWo8TBV5qpyCfGz8j55w6bPJVB6qMyR7DXVUku8WRT`
  - BURN signs: `5sJRrzhhXgcXZYxiw6GoH4bngwgZ7bZVp7jqk5aLJS7a`,
    `DpNQKYNd9dGkES8no5vP8csnCiqq5c8Po4noi5ed6LQd`,
    `AhQ3TrBNTNu1wNpt34R6aMVoS3T4Zm9mBVU1Eg2Lw9B1` (fires)
- Live state matched (`get_state`: pool_x 1781514, pool_y 1333500, supply 2478480,
  treasury 31486/1500, burned 36520, epoch 4; burned arithmetic closes
  36520 = 21186 + 334 + 15000).

## Honest caveats
- Same as Bastion: the house verdict was FIX on the literal GitHub term; the bounty
  was PAID Nov 6 anyway. Publication-only gap — do not re-litigate.
- No video exists for this track — the demo post uses the real screenshot
  (`docs/demo-screenshot.png`, 766×1101, regenerated from the transcript).

## House edits — 2026-11-14 (NEAR review, Tommy's order)
Prose/link only: tunnel clone -> GitHub path. Tests re-run after the edit: 21/21,
verify.sh PASS. Evidence code untouched.
