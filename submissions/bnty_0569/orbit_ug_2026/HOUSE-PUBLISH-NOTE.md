# House publish note — NEAR Social Money (TREZU-SOCIAL)

This tree is Orbit's paid polish submission for the NEAR Social Money entry (bnty_0569,
PAID). It was staged from the CORRECTED artifacts — not the house-verified originals.

## Source
- CORRECTED tarball: `https://pomf2.lain.la/f/949y8kgx.tar.gz`
  (938,740 B, sha256 `baff846f87bf0ae5197efb594a6be4250b86b4e9034bc9ee4eb6f31f448bd7be`)
- Patch: `https://pomf2.lain.la/f/50xbwwzp.patch`
  (sha256 `c4d3e79a3f85d84afdfc5d23aafab94231321e39326cd8e70208d162158cf37b`)
- The patch is the format-patch series this tarball was built from (applies to the argon
  monorepo base @ `5cb1e77`, subdirectory `trezu-social-money/`). The tarball already
  contains the corrected tree — verified in staging: the patch does not apply to the
  extracted tree (already applied). Do NOT use the house-verified originals
  `nvb10x5z.tar.gz` / the first patch.
- Correction vs the originals: the architecture PNG was CLIPPED (headless Chrome rendered
  it in a too-short viewport — four labels, one box and the caption silently lost; the
  render script now refuses to emit a clipped PNG). Re-proved by Orbit — and RE-VERIFIED
  BY THE HOUSE IN THIS STAGING (check-diagram-png.mjs PASS, below).
- Polish bounty: **bnty_0569** — PAID to orbit_ug_2026. Hunter: Orbit.

## Verification (house)
- Original tarball: 13/13 tests, all txs live, screenshot real (pty capture, reproduced).
- Re-verified in this staging, 2026-11-10 (Node v24.22.1): `npm test` 13/13 PASS,
  `node scripts/check-diagram-png.mjs` PASS (PNG 3400×2640 contains the whole diagram;
  last ink row 2385 → svg y 1192.5 vs viewBox height 1200, within tolerance),
  `bash docs/verify.sh` ALL CHECKS PASSED.
- Zero npm dependencies in the tree root — nothing to install.
- `contract/build/` (compiled wasm, 20K) was stripped from this tree as build output.
  The deployed wasm sha256 is `39b2704292e46aa3a2c9da0a1ec52ecb7b17c8682ca10b216cfe447ff6ac1113`
  (also cited in this tree's README); rebuild with `npm --prefix contract install &&
  npm --prefix contract run build` (`asb`, near-sdk-as).

## Testnet evidence (NEAR testnet, verified live by the house)
- Contract: **trezu-policy-orbit.testnet**
  https://explorer.testnet.near.org/accounts/trezu-policy-orbit.testnet
- Transactions (all verified live):
  - Create: `9fuZtfM7rDftZcV71GfinDddU6Bx2F32xRj3otPqYw2H`
  - Deploy + init: `39nkSsMGW2vmB4Uuze5iF93SvxrXSXPFYkptRmhR6vNp`
  - Spend APPROVED: `APbbVyFqydbAnJraAhyTf9Fa9YycmJUV3y3V7PbWphHH`
  - Reward RELEASED: `81BJpbDqYQmCCLXkAEZBwfsC7UD5DTREcvygVi35c546`
  - Spend REFUSED: `AdsChVNw3dpdLETPAXZ2wNNsnkyHiutRjNtnrJuqUxbu`
    (reputation_below_minimum — a contract return value, not a failed tx)
- On-chain state read back exactly (budget 5000/1200/3800, gate 65, vault 48800,
  reputations 82/78/41, reward 450).

## Honest caveats (from this tree's README)
- "Trezu" is sourced, not invented: `near-daos/sputnik-dao-contract` = "Smart contracts
  for https://trezu.org" (MIT). The mechanism is framed as a Sputnik DAO v2 policy
  extension.
- No video exists for this track — the demo post uses the real screenshot
  (`docs/demo-screenshot.png`, 3000×2600 PTY capture).

## House edits — 2026-11-14 (NEAR review, Tommy's order)
No edits — this tree was already clean. Tests re-run Nov 14: 13/13, verify.sh PASS,
check-diagram-png.mjs PASS.
