# House publish note — NEAR Real-World Money (Anchor)

This tree is Orbit's paid polish submission for the NEAR Real-World Money entry
(bnty_0513, PAID).

## Source
- FILED tarball: `https://pomf2.lain.la/f/zfycx8dq.tar.gz`
  (sha256 `c1c547d679de2b41a3acb14e80414ea29bfe61c88843ab0fa598b944689c0235`, 225 KB)
- The bundle (`5etlazzr.bundle`, sha256
  `3a52d2bbdfdb8de0ef6890c425e0157d6fabe7dd84065aee5e8144c6fb15ec10`, 11 commits,
  HEAD `3994eac35acf3c257219dd68c8a35ee9730f0e15`) was NOT used: it is 36 MB because
  an old commit accidentally included the contract's `target/` (127 MB). The tarball
  tree is the clean artifact — publish this tree, never the bundle history.
- Polish bounty: **bnty_0513** — PAID to orbit_ug_2026. Hunter: Orbit.

## Verification (house)
- Nov 6: bundle clones, tarball hash-exact, `docs/verify.sh` 25 checks.
- Re-verified in this staging, 2026-11-10 (Node v24.22.1): `bash docs/verify.sh`
  ALL CHECKS PASSED (25 checks), `npm test` 25/25 PASS.
- Zero npm dependencies — nothing to install. `node_modules/` was never present.

## Testnet evidence (NEAR testnet, verified live by the house)
- Contract: **orbit-anchor.testnet**
  https://explorer.testnet.near.org/accounts/orbit-anchor.testnet
- Transactions (all SuccessValue, verified live — these are the TREE README's 4 txs):
  - Deploy: `FtmHjK5gDVEb7QF2PNniPbqFgyzkgag78A3mykPqSZem`
  - Create invoice: `D7nrZ5By6bbD6wuEJLNWc3H9Kir8R52oEdp31VXh9gBo`
  - Pay invoice: `BYQXg5RnXDjZ2Sa3fYe7snn2DdWVvL9fkAUHeKM3wLJR`
    (signed by orbit-buyer.testnet)
  - Remit: `3ZYB1neLPyRUAE6Gu1hvWLJKkqNePuReyNqWgP3pvs2B`
- WARNING: the bnty_0513 board body pastes the WRONG tx block (the 8 Bastion txs) and
  falsely claims a redeploy — no redeploy happened (code_hash unchanged). This tree's
  README carries the correct 4 Anchor txs above. Submission drafts must use the tree's
  txs, never the board body.

## Honest caveats
- No video exists for this track — the demo post uses the real screenshot
  (`docs/demo-screenshot.png`, byte-identical to the Surge index page).

## House edits — 2026-11-14 (NEAR review, Tommy's order)
Prose/link only: tunnel clone -> GitHub path; template placeholder
`nearvalidate.org/txns/<hash>?network=testnet` -> `testnet.nearblocks.io/txns/<hash>`.
Tests re-run after the edit: 25/25, verify.sh PASS. Evidence code untouched.

## House correction — 2026-11-14 (Anchor deployment discrepancy)
An external reviewer found the published README contradicted itself: section 5 and the
section 8 limitations list said no contract was deployed, while section 7b claimed a
testnet deployment with 4 transaction hashes. The house re-verified all 4 hashes live
against the archival testnet RPC on Nov 14:
- deploy `FtmHjK5gDVEb7QF2PNniPbqFgyzkgag78A3mykPqSZem` — DeployContract, FINAL
- create_invoice `D7nrZ5By6bbD6wuEJLNWc3H9Kir8R52oEdp31VXh9gBo` — FINAL
- pay_invoice `BYQXg5RnXDjZ2Sa3fYe7snn2DdWVvL9fkAUHeKM3wLJR` — signed by orbit-buyer.testnet, FINAL
- remit `3ZYB1neLPyRUAE6Gu1hvWLJKkqNePuReyNqWgP3pvs2B` — FINAL
Live chain state matches the README exactly: get_invoice(lot-anchor-001) paid=true,
remitted=true, nonce=3; get_counter=3. The deployment is REAL. Sections 5 and 8 carried
stale template lines from before the deployment and were corrected in this commit (prose
only — no evidence, code, or hashes were changed). Note: Nearblocks v3 returned an empty
result for the deploy hash; the archival RPC is the authority here.
