# House publish note — NEAR Security (Bastion)

This tree is Orbit's paid polish submission for the NEAR Security entry (bnty_0517, PAID).

## Source
- FILED bundle: `https://pomf2.lain.la/f/h26hqinu.bundle`
  (sha256 `8aae412a1f784d56c11247bb854b72d64d9cc68b30099170050dc0ca38c00b8d`,
  7 commits, HEAD `ef02889325dbc26eb0ce0e69628218c8944edd08`)
- FILED tarball: `https://pomf2.lain.la/f/n7llwsrh.tar.gz`
  (sha256 `baeb6fba44481933882636c54519fd46c59bb1db9ee217512f2dcb1257af3b3b`)
- Staged from the tarball; verified byte-identical to the bundle-clone tree
  (`diff -r` exit 0, 24 files each). Do NOT use the tunnel git URL — it serves the
  STALE pre-fix tree (HEAD `8b1fb83`).
- Polish bounty: **bnty_0517** — PAID to orbit_ug_2026 (Nov 6). Hunter: Orbit.

## Verification (house)
- Nov 6: bundle clones with full history, tarball hash-exact, `docs/verify.sh` passes.
- Re-verified in this staging, 2026-11-10 (Node v24.22.1): `bash docs/verify.sh`
  ALL CHECKS PASSED (28 checks), `npm test` 29/29 PASS.
- Zero npm dependencies — nothing to install. `node_modules/` was never present.

## Testnet evidence (NEAR testnet, verified live by the house)
- Contract: **orbit-bastion.testnet**
  https://explorer.testnet.near.org/accounts/orbit-bastion.testnet
- Transactions (all SuccessValue, verified live):
  - Deploy: `Ha4hPJn2AiF9ds3mc1NrkjAiAtJzYNNkPihFZQzuvCk1`
  - Set limit: `HivpunEsMMTUFYf9hCsYG5Ekg3gNR93RmasGaYrRdWtF`
  - Screens: `CRmwGwVZMmCLFMoT388MiT64Tmp9TXuyLvEqi66r8WVJ`,
    `JAFi3z3Sxv9veNyNvjERrH2aZjFDisdKA3JYup7kv2GA`
  - Spends: `G2wgSd8jwRVSo6rk4tVHHuXBXhfyT2rkZVhE9e5bda4u`,
    `EFM9nvH5AkUF6wktezvoMTme3Fe1YNmvAXh9VwZAdcnh`,
    `Bo52ZTfykej9m49BXD9FvpXgGBXiqEomhbMC2Jznom9c` (BLOCKED overspend),
    `ERN78NNRF24LvEFvQbX4V2AmtTLM8muZuaaa11dkL2nJ` (BLOCKED flagged scam)
- A BLOCK is a recorded on-chain decision, not a failed tx — it resolves via RPC.
  Live state read back (`get_limit` 1e15, both refusals verbatim in `get_spends`,
  `get_flags` match).

## Honest caveats
- The house verification verdict on the filing was FIX on the literal GitHub term;
  the bounty was PAID Nov 6 anyway. The GitHub gap is publication-only, not a payment
  dispute — do not re-litigate.
- No video exists for this track — the demo post uses the real screenshot
  (`docs/demo-screenshot.png`, 766×1311, regenerated from the current transcript).

## House edits — 2026-11-14 (NEAR review, Tommy's order)
Prose/link only: tunnel clone -> GitHub path; "Seven real testnet transactions" ->
"Eight" (the table lists 8; 8 confirmed live). Tests re-run after the edit: 29/29,
verify.sh PASS. Evidence code untouched.

## House correction — 2026-11-14 (verify.sh scope check)

The tree's own gate `docs/verify.sh` failed 1 of 28 checks on a fresh clone: check #16
required the README to name the public repository, but its grep target was the dead
Cloudflare-tunnel clone URL from the original filing (`dover-break-advisor-programs.…`).
The README already names the real public repository
(`git clone https://github.com/Rizzzo21/dail-bounty-submissions.git`). House fix: the
check's grep target now matches the public GitHub URL. Check count unchanged (28);
no evidence, contract code, or test was touched. Re-run after the fix: 28/28 PASS.
