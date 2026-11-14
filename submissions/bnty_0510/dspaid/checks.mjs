#!/usr/bin/env node
// DAiL bnty_0485 — my own checks (bounty item 3): each check tests a claim the thesis makes,
// against live NEAR RPC, independent of model.mjs. Exit 0 only if every executed check passes.
//
// Usage:  node checks.mjs      (requires thesis_data.json from `node model.mjs`)
// Output: checks_result.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.dirname(fileURLToPath(import.meta.url));
// bnty_0510 polish: fastnear public RPCs are primary (official endpoints kept as fallback).
// House mirror fix (2026-11-14): archival RPC added as a third testnet candidate — the
// `tx` lookup for OLD hashes times out on fastnear and the official endpoint, while
// archival-rpc.testnet.near.org resolves them (verified live Nov 14 on the filed hashes).
const RPCS = {
  testnet: ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org', 'https://archival-rpc.testnet.near.org'],
  mainnet: ['https://rpc.fastnear.com', 'https://rpc.mainnet.near.org'],
};
const AGENT_TX_GAS = 5_000_000_000_000n; // 5 TGas, same tx class as claim C2
const COST_TOL = 0.1; // 10% relative tolerance: gas prices legitimately drift between model run and check re-run
const STALE_MIN_BLOCKS = 3600; // CHECK-1 recency grace floor (~1 h of chain growth) before flagging stale heights
const STALE_GROWTH_FACTOR = 3; // CHECK-1 recency: tolerate up to 3x the expected height growth since generated_at

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${url} ${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

async function pickRpc(name) {
  let lastErr;
  for (const url of RPCS[name]) {
    try { const s = await rpc(url, 'status', {}); if (s.chain_id === name) return url; } catch (e) { lastErr = e; }
  }
  throw new Error(`${name}: no live RPC among ${RPCS[name].join(' | ')} (${lastErr?.message})`);
}

const results = [];
function record(id, claim, pass, detail) {
  results.push({ id, claim, verdict: pass ? 'PASS' : 'FAIL', detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}: ${claim}\n      ${detail}`);
}

async function check1_liveness(thesis) {
  // Thesis claim C1: both networks are live and advancing — stale recorded heights must have moved.
  // bnty_0510 fix: "live > recorded" alone passed fabricated/stale heights; recorded heights must now
  // also be RECENT: the observed growth is bounded by expected chain growth since thesis_data.json's
  // generated_at (using its own recorded block interval), so old copied-in heights fail the check.
  const lines = [];
  let pass = true;
  const genMs = Date.parse(thesis.generated_at);
  for (const name of Object.keys(RPCS)) {
    try {
      const url = await pickRpc(name);
      const now = Number((await rpc(url, 'status', {})).sync_info.latest_block_height);
      const rec = thesis.networks[name];
      const advanced = now - rec.latest_block_height;
      const expected = Math.max(0, (Date.now() - genMs) / 1000) / rec.block_interval_seconds;
      const limit = Math.max(STALE_MIN_BLOCKS, STALE_GROWTH_FACTOR * expected);
      const ok = advanced > 0 && advanced <= limit;
      pass &&= ok;
      lines.push(`${name}: recorded ${rec.latest_block_height} -> live ${now} (+${advanced}, recency limit ${Math.round(limit)} blocks)`);
    } catch (e) { pass = false; lines.push(`${name}: RPC error ${e.message}`); }
  }
  record('CHECK-1', 'thesis C1 liveness: recorded block heights are real, RECENT, and the chains keep advancing', pass, lines.join('; '));
}

async function check2_micropayment(thesis) {
  // Thesis claim C2: a 5 TGas agent transaction costs < 0.01 NEAR at live gas prices.
  // bnty_0510 fix (STEP-3 hole): CHECK-2 must not merely re-price a fresh number — the RECORDED
  // agent_tx_cost_near + gas_price_yocto_per_gas in thesis_data.json must match the live
  // recomputation within tolerance. Corrupting the file to v1 values (0.5 NEAR @ 1e11 yocto/gas)
  // now fails here instead of passing silently.
  const lines = [];
  let pass = true;
  for (const name of Object.keys(RPCS)) {
    try {
      const url = await pickRpc(name);
      const gp = await rpc(url, 'gas_price', [null]);
      const liveGas = Number(gp.gas_price);
      const liveCost = Number(AGENT_TX_GAS * BigInt(gp.gas_price)) / 1e24;
      const rec = thesis.networks[name];
      const gasOk = Math.abs(liveGas - Number(rec.gas_price_yocto_per_gas)) <= COST_TOL * liveGas;
      const costOk = Math.abs(liveCost - rec.agent_tx_cost_near) <= COST_TOL * liveCost;
      const cheapOk = rec.agent_tx_cost_near < 0.01 && liveCost < 0.01;
      const classOk = rec.agent_tx_gas_tgas === 5;
      const ok = gasOk && costOk && cheapOk && classOk;
      pass &&= ok;
      lines.push(`${name}: recorded gas ${rec.gas_price_yocto_per_gas} / cost ${rec.agent_tx_cost_near} NEAR vs live gas ${liveGas} / cost ${liveCost.toFixed(8)} NEAR (match<=10%: gas=${gasOk} cost=${costOk}; <0.01: ${cheapOk}; 5TGas class: ${classOk})`);
    } catch (e) { pass = false; lines.push(`${name}: RPC error ${e.message}`); }
  }
  record('CHECK-2', 'thesis C2 viability: recorded cost/gas price equal the live recomputation and a 5 TGas agent tx costs < 0.01 NEAR', pass, lines.join('; '));
}

async function check3_tx_evidence() {
  // Thesis claim (evidence side): recorded testnet tx hashes resolve to real successful transactions.
  const f = path.join(outDir, 'tx_evidence.json');
  if (!existsSync(f)) { record('CHECK-3', 'thesis evidence: recorded testnet tx hashes verify on-chain', false, 'tx_evidence.json missing — run `node near_tx.mjs` first'); return; }
  const ev = JSON.parse(readFileSync(f, 'utf8'));
  const lines = [];
  let pass = true;
  // bnty_0510: recorded RPC first, then the fallback list (an RPC being down must not fake a FAIL).
  const candidates = [...new Set([ev.rpc, ...RPCS.testnet])];
  for (const tx of ev.transactions) {
    try {
      let q, lastErr;
      for (const url of candidates) { try { q = await rpc(url, 'tx', [tx.tx_hash, tx.sender]); break; } catch (e) { lastErr = e; } }
      if (!q) throw lastErr;
      const kind = Object.keys(q.status ?? {})[0];
      const t = q.transaction ?? {}; // signer/receiver live under the `transaction` field of the RPC result
      const ok = kind === 'SuccessValue' && t.signer_id === tx.sender && t.receiver_id === tx.receiver;
      pass &&= ok;
      lines.push(`${tx.label} ${tx.tx_hash}: status=${kind} signer/receiver match=${t.signer_id === tx.sender && t.receiver_id === tx.receiver} block=${q.transaction_outcome?.block_height}`);
    } catch (e) { pass = false; lines.push(`${tx.label} ${tx.tx_hash}: not found on-chain (${e.message})`); }
  }
  record('CHECK-3', 'thesis evidence: every recorded testnet tx hash re-queries as a real, successful transaction', pass, lines.join('; '));
}

async function main() {
  const thesis = JSON.parse(readFileSync(path.join(outDir, 'thesis_data.json'), 'utf8'));
  console.log('=== OWN CHECKS AGAINST THESIS CLAIMS (live RPC) ===');
  await check1_liveness(thesis);
  await check2_micropayment(thesis);
  await check3_tx_evidence();
  const allPass = results.every((r) => r.verdict === 'PASS');
  writeFileSync(path.join(outDir, 'checks_result.json'), JSON.stringify({ schema: 'dail-near-thesis-checks-v1', ran_at: new Date().toISOString(), results, overall: allPass ? 'PASS' : 'FAIL' }, null, 2) + '\n');
  console.log(`CHECKS: ${results.filter((r) => r.verdict === 'PASS').length}/${results.length} PASS -> ${allPass ? 'PASS' : 'FAIL'}`);
  if (!allPass) process.exit(1);
}

main().catch((e) => { console.error('CHECKS FAIL:', e.message); process.exit(1); });
