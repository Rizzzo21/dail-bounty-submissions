# House publish note — NEAR Swarms (Swarm Market)

This tree is Orbit's paid polish submission for the NEAR Swarms entry (bnty_0512, PAID),
plus the verified video bnty_0523.

## Source
- FILED bundle: `https://pomf2.lain.la/f/p63kci8y.bundle`
  (sha256 `2fc26b2195d3adb075cc552d05dbb4e19df4f1fc22357b811f104468376e7e63`,
  11 commits, HEAD `75effa065af78d20d8b6fea59c0cc2d0adbad742`)
- FILED tarball: `https://pomf2.lain.la/f/3drt3d87.tar.gz`
  (sha256 `25a52ee92f2418a049e7dc9bf529e4fd21dad5a65300cc7ab231cb4251629fa8`)
- Staged from the tarball; verified byte-identical to the bundle-clone tree
  (`diff -r` exit 0, 36 files each). Do NOT use the newest Surge files — the newest
  READMEs carry a curl/clone bundle-name mismatch.
- Polish bounty: **bnty_0512** — PAID to orbit_ug_2026. Video bounty **bnty_0523** — PAID.
  Hunter: Orbit.

## Verification (house)
- Nov 6: bundle clones with full history, tarball hash-exact, `docs/verify.sh`
  28 checks (clone) / 26 (tarball — the 2-check gap is the two git-only checks).
- Re-verified in this staging, 2026-11-10 (Node v24.22.1): `bash docs/verify.sh`
  ALL CHECKS PASSED (26 checks — the git-only checks skip outside a git repo, as
  documented), `npm test` 68/68 PASS.
- Zero npm dependencies — nothing to install. `node_modules/` was never present.

## Testnet evidence (NEAR testnet, verified live by the house)
- Contract: **orbit-swarm.testnet**
  https://explorer.testnet.near.org/accounts/orbit-swarm.testnet
- Transactions (all SuccessValue, verified live):
  - Create invoice: `7Jwaqo44WhMPJRSADhDRTGk3uGMRqtHHu2kh1eWKU1nK`
  - Pay invoice: `5kzyXcj2V98qm8vfzHBtfc8v2HJJUc62xeAFcnzMa1Ve`
  - Remit: `2cGjD5dZXaRN4HQJXbPztLMiDTEKbens9dYPSekr4PAa`
- Demo asset: VIDEO bnty_0523 (1:55, verified) — mp4
  `https://pomf2.lain.la/f/igvq380i.mp4`, plus a real screenshot in-tree.

## Honest caveats (left as filed — see below, not edited)
- README sentence "extracts into `near-entry/`" is FALSE — the tarball extracts into
  `entry/`. Left as filed in this tree; noted here so the submission draft uses `entry/`.
- README line 69 "(7 commits)" is stale — the history is 11 commits.
- The `tools/publish-github-repo.sh` in this tree creates the GitHub repo once a token
  exists; it was not run by the house (no GitHub credential on this box).

## House edits — 2026-11-14 (NEAR review, Tommy's order)
Prose/link only: bundle link ng9ls6ri -> filed bundle p63kci8y (11 commits, HEAD 75effa06);
tunnel clone -> GitHub path; "(7 commits)" -> 11 commits; "extracts into `near-entry/`" ->
`entry/`; "Why not GitHub?" box updated. Tests re-run after the edit: 68/68,
verify.sh PASS. Evidence code untouched.
