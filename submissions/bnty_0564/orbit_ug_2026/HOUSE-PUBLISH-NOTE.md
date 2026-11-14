# House publish note — NEAR Privacy (BLIND-ESCROW)

This tree is Orbit's paid polish submission for the NEAR Privacy entry (bnty_0564, PAID).
It was staged from the CORRECTED artifacts — not the house-verified originals.

## Source
- CORRECTED tarball: `https://pomf2.lain.la/f/c944ijhj.tar.gz`
  (sha256 `ebbfdbd55c29451fa9916697e1df9c94e6192230feb81c87b811ec2ecd3c9fb8`)
- Patch: `https://pomf2.lain.la/f/a5oobmee.patch`
  (sha256 `388c4308a1b9f75701cc9ef6ab285129d3e04a836063673cdbbf295b57e0b17e`)
- The patch is the format-patch series this tarball was built from (applies to the argon
  monorepo base @ `5cb1e77`, subdirectory `shielded-private-escrow/`). The tarball
  already contains the corrected tree — verified in staging: the patch does not apply
  to the extracted tree (already applied). Do NOT use the house-verified originals
  `39j1zeca.tar.gz` / `ew67kjyo.patch`.
- Correction vs the originals: ONE stale README hash line (the capture hash). Re-proved
  by Orbit from a fresh clone — and RE-VERIFIED BY THE HOUSE IN THIS STAGING (below).
- Polish bounty: **bnty_0564** — PAID to orbit_ug_2026. Hunter: Orbit.

## Verification (house)
- Original tarball (Nov 6–9): 32/32 tests, commitment recomputed exactly, mutation
  test reproduced (9 red → 32 green).
- Re-verified in this staging, 2026-11-10 (Node v24.22.1): `npm test` 32/32 PASS,
  `bash docs/verify.sh` ALL CHECKS PASSED. Commitment recomputed independently:
  `printf '%s' "750|3ed774c71e0a22f286fa3b0b7cd014b1f0ffd741c1f97f442f974f3b5aa24181|701" | sha256sum`
  → `92e8d2473770145999bc93d1bf7b374d67348ef3de28e308e5bff7982cff6ff6` (exact match).
- Zero npm dependencies — nothing to install. `node_modules/` was never present.

## Testnet evidence (NEAR testnet, verified live by the house)
- Contract: **blind-escrow-orbit.testnet**
  https://explorer.testnet.near.org/accounts/blind-escrow-orbit.testnet
- Transactions (all verified live):
  - Deploy: `7AsayMMoetQz1tjfKvVWXjbGJeGd86sjS2dMztofEvnm`
  - Pool funding: `GqtJjTNN3ppmTdEJWrHXYCKyjN1Fstxr7qAW72Bqz7cG`
  - Open job: `BUi4NRojnYffXkvcBDwmJxP7YvsQgaqE1JEEWUUWK92y`
  - Forged settle (REFUSED): `E5ADPW1gR5fwDrPzWa85SiD8kYwiBGzXEyfJFj7s2G6T`
    (Failure, exact panic "opening rejected: recomputed commitment does not match")
  - Correct settle: `491W4LhJVWKNVtF1JP3Tw2pvjU4nZ9AT5hZSefsXMuU4`
    (paid 0.75 NEAR to worker)
- The house backstop (`blndesc-backstop-1109.testnet`) is backup ONLY — this paid
  submission is canonical. Do not publish the backstop as this entry.

## Honest caveats (from this tree's README §5)
- Demo seed stands in for a random blinding factor.
- On-chain deposit amounts are public: pre-settle STATE privacy only, not amount privacy.
- 0.001-NEAR unit scale is testnet scale, not 750 USDC.
- No video exists for this track — the demo post uses the real screenshot
  (`docs/demo-screenshot.png`, genuine PTY capture).

## House edits — 2026-11-14 (NEAR review, Tommy's order)
Prose/link only: 6 explorer links `nearblocks.io` -> `testnet.nearblocks.io`.
Tests re-run after the edit: 32/32, verify.sh PASS. Evidence code untouched.
