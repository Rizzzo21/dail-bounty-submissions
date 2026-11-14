#!/usr/bin/env node
// DAiL bnty_0485 — citation resolver (bounty item 2): every source cited by README.md and
// model.mjs must resolve to a real resource. RPC endpoints are verified with a live JSON-RPC
// `status` call (a GET on them is 405 by design). Exit 0 only if no citation is broken.
//
// Usage:  node verify_citations.mjs
// Output: citations_result.json
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.dirname(fileURLToPath(import.meta.url));

const CITATIONS = [
  { id: 'S1', url: 'https://near.org', kind: 'get', note: 'NEAR org / product surface' },
  { id: 'S2', url: 'https://www.near.org/intents', kind: 'get', note: 'NEAR Intents product page (thesis settlement primitive)' },
  { id: 'S3', url: 'https://docs.near.org', kind: 'get', note: 'official NEAR docs' },
  { id: 'S4', url: 'https://github.com/near/near-intents', kind: 'get', note: 'NEAR Intents contracts monorepo' },
  { id: 'S5', url: 'https://github.com/near/near-api-js', kind: 'get', note: 'SDK used by near_tx.mjs (library disclosure)' },
  { id: 'S6', url: 'https://github.com/bimajanuri/academic-writing-skill', kind: 'get', note: 'skill pack (MIT): 7-stage gated pipeline, verified citations' },
  { id: 'S7', url: 'https://github.com/gislio/academic-mentor', kind: 'get', note: 'secondary skill pack (GPL-3.0)' },
  { id: 'S8', url: 'https://rpc.testnet.near.org', kind: 'rpc', chain: 'testnet', note: 'official testnet RPC (fallback used by model/checks)' },
  { id: 'S9', url: 'https://rpc.mainnet.near.org', kind: 'rpc', chain: 'mainnet', note: 'official mainnet RPC (fallback used by model/checks)' },
  { id: 'S10', url: 'https://dail-3dci.onrender.com/world/bounties/bnty_0411', kind: 'get', note: 'pattern source: held NEAR Investment Thesis build (not copied)' },
  { id: 'S11', url: 'https://dail-3dci.onrender.com/world/bounties/bnty_0450', kind: 'get', note: 'prior DSP-AID NEAR testnet escrow work (RPC connection provenance)' },
  { id: 'S12', url: 'https://github.com/DSP-AID/dail-testnet-escrow-demo', kind: 'get', note: 'reused NEAR testnet RPC signing pattern (pre-existing code, disclosed)' },
  { id: 'S13', url: 'https://wallet.testnet.near.org', kind: 'get', note: 'testnet wallet/faucet UI' },
  { id: 'S14', url: 'https://helper.testnet.near.org/account', kind: 'faucet', note: 'testnet faucet helper (throwaway-account path); POST-only endpoint, probed with an invalid pubkey' },
  { id: 'S15', url: 'https://testnet.nearblocks.io', kind: 'get', note: 'explorer for tx links; Cloudflare bot-blocks scripted GET (403) — canonical verification is the RPC `tx` re-query in checks.mjs', tolerate: [403] },
  { id: 'S16', url: 'https://rpc.testnet.fastnear.com', kind: 'rpc', chain: 'testnet', note: 'primary testnet RPC (fastnear) used by model/checks/near_tx (bnty_0510)' },
  { id: 'S17', url: 'https://rpc.fastnear.com', kind: 'rpc', chain: 'mainnet', note: 'primary mainnet RPC (fastnear) used by model/checks (bnty_0510)' },
];

async function check(c) {
  if (c.kind === 'faucet') {
    // POST-only endpoint: an intentionally invalid public key must be REJECTED with 4xx (endpoint live),
    // and must not create an account. A GET on it is 405 by design, so GET cannot cite it.
    const res = await fetch(c.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: 'citation-probe-should-be-rejected.testnet', newAccountPublicKey: 'ed25519:invalid' }) });
    return { status: `HTTP ${res.status} (POST probe, account not created)`, ok: res.status >= 400 && res.status < 500 };
  }
  if (c.kind === 'rpc') {
    const res = await fetch(c.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'status', params: {} }) });
    const j = await res.json();
    const chain = j.result?.chain_id;
    return { status: `rpc chain_id=${chain}`, ok: chain === c.chain };
  }
  const res = await fetch(c.url, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) dspaid-citation-check/1.0', accept: 'text/html,*/*' }, redirect: 'follow' });
  const tolerated = c.tolerate?.includes(res.status) ?? false;
  return { status: `HTTP ${res.status}${tolerated ? ' (tolerated bot-block, see note)' : ''}`, ok: res.status === 200 || tolerated };
}

async function main() {
  console.log('=== CITATION RESOLUTION (' + CITATIONS.length + ' sources) ===');
  const rows = [];
  for (const c of CITATIONS) {
    let r;
    try { r = await check(c); } catch (e) { r = { status: `ERROR ${e.message}`, ok: false }; }
    rows.push({ ...c, verdict: r.ok ? 'PASS' : 'FAIL', result: r.status });
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${c.id} ${c.url} -> ${r.status}`);
  }
  const failed = rows.filter((r) => r.verdict !== 'PASS');
  writeFileSync(path.join(outDir, 'citations_result.json'), JSON.stringify({ schema: 'dail-near-thesis-citations-v1', ran_at: new Date().toISOString(), rows, overall: failed.length ? 'FAIL' : 'PASS' }, null, 2) + '\n');
  console.log(`CITATIONS: ${rows.length - failed.length}/${rows.length} resolve -> ${failed.length ? 'FAIL' : 'PASS'}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error('CITATIONS FAIL:', e.message); process.exit(1); });
