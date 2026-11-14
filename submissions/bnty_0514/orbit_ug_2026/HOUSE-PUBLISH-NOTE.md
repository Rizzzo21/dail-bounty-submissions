# House publish note — NEAR Open (Passport)

This tree is Orbit's paid polish submission for the NEAR Open entry (bnty_0514, PAID),
plus the verified video bnty_0524.

## Source
- FILED bundle: `https://pomf2.lain.la/f/7drzoshy.bundle`
  (sha256 `1b7bba5a582878bb83feedac3f6ef1717ece4aa2b348300f3903e136c0479ee2`,
  10 commits, HEAD `52d652cf83c4f74f675faeba673b0dac57971424`)
- FILED tarball: `https://pomf2.lain.la/f/d7r9d5yh.tar.gz`
  (sha256 `e455d8140fe223ebe0eb8df2a7fd6e63195e124341bc2a03c94471dec4217b3e`,
  extracts into a single `passport/` dir)
- Staged from the tarball; verified byte-identical to the bundle-clone tree
  (`diff -r` exit 0, 34 files each). Do NOT use the newest Surge files — the
  resubmission-cited newest Surge files 404.
- Polish bounty: **bnty_0514** — PAID to orbit_ug_2026. Video bounty **bnty_0524** — PAID.
  Hunter: Orbit.

## Verification (house)
- Nov 6: "cleanest of the five" — `docs/verify.sh` 33 checks in clone and tarball.
- Re-verified in this staging, 2026-11-10 (Node v24.22.1): `bash docs/verify.sh`
  ALL CHECKS PASSED (33 checks), `npm test` 26/26 PASS.
- Zero npm dependencies — nothing to install. `node_modules/` was never present.

## Testnet evidence (NEAR testnet, verified live by the house)
- Contract: **orbit-passport.testnet**
  https://explorer.testnet.near.org/accounts/orbit-passport.testnet
- Transactions (verified live):
  - Register (ava): `5T1MaW7z2WAw3M2Yw9jCKfRhWDZ9mXpEMTaxWECou4mc`
  - Register (bob): `FMrJr5jY2pBohhGg8SPg7ZomSHmZnFKUudFMydeKK7ng`
  - Open escrow (ava): `CF6n967pHCXDou6f5UjLu21zMcLHMxf3fheJ7kreRr4c`
    (Failure — disclosed on-chain refusal, community score below threshold)
  - Open escrow (bob): `4BHUC53FTETSu2rMUgbYDgw8ezwgUKf6fa7XjHK3ETak`
- Live state matched exactly (bob escrow present, ava empty, threshold 50.0).
- Demo asset: VIDEO bnty_0524 (1:58, verified) — mp4
  `https://pomf2.lain.la/f/i9kdh3m3.mp4`, plus a real screenshot in-tree.

## Honest caveats (left as filed — see below, not edited)
- `docs/PUBLIC_URLS.txt` is stale (non-blocking, noted here).
- README §5b simulated-vs-deployed section is present — read it before judging the demo.

## House edits — 2026-11-14 (NEAR review, Tommy's order)
Prose/link only: tunnel clone -> GitHub path; dead tunnel recording page + dead uguu
mirror removed (pomf2 mp4 is the live copy); docs/PUBLIC_URLS.txt rewritten (canonical =
GitHub path, tunnel retired). Tests re-run after the edit: 26/26, verify.sh PASS.
Evidence code untouched.
