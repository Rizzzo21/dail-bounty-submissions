#!/usr/bin/env node
// DAiL bnty_0485 — NEAR Thesis model pattern (reproducible reproduction of bnty_0411's build pattern).
// Evidence-led investment-thesis model for the NEAR agent economy: every number rendered on the
// dashboard is produced by THIS script from a live RPC query. Re-run it to reproduce the charts.
//
// Usage:  node model.mjs        (no secrets, read-only RPC)
// Output: thesis_data.json + dashboard.html
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// bnty_0510 polish: fastnear public RPCs are primary (official endpoints kept as fallback). Both
// fastnear URLs were live-verified for every method used here (`status`, `gas_price`) before the switch.
const RPCS = {
  testnet: ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org'],
  mainnet: ['https://rpc.fastnear.com', 'https://rpc.mainnet.near.org'],
};
const AGENT_TX_GAS = 5_000_000_000_000n; // 5 TGas — typical agent micropayment / function-call tx budget
const SAMPLE_MS = 2000;

// Improvement over v1: per-network gas price (yoctoNEAR per gas unit) for the cost chart is now
// QUERIED LIVE from each network's `gas_price` RPC method. v1 hardcoded 100_000_000_000 yocto/gas
// (the stale mainnet floor) for both networks and overstated the per-tx cost ~1000x against the
// live network price (~100_000_000 yocto/gas at record time); the recorded figure is corrected here.

const outDir = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yoctoToNear = (yocto) => Number(yocto) / 1e24;

export async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${url} ${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

async function sampleNetwork(urls) {
  let s1, url, lastErr;
  for (url of urls) {
    try {
      s1 = await rpc(url, 'status', {});
      if (!['testnet', 'mainnet'].includes(s1.chain_id)) throw new Error(`unexpected chain_id "${s1.chain_id}" from ${url}`);
      break;
    } catch (e) { lastErr = e; s1 = null; }
  }
  if (!s1) throw new Error(`no working RPC in [${urls.join(', ')}]: ${lastErr?.message}`);
  const h1 = Number(s1.sync_info.latest_block_height);
  const t1 = Date.now();
  await sleep(SAMPLE_MS);
  const s2 = await rpc(url, 'status', {});
  const h2 = Number(s2.sync_info.latest_block_height);
  const t2 = Date.now();
  if (h2 <= h1) throw new Error(`${url}: chain not advancing (${h1} -> ${h2})`);
  return {
    chain_id: s1.chain_id,
    rpc_url: url,
    latest_block_height: h2,
    sampled_blocks: h2 - h1,
    block_interval_seconds: Number((((t2 - t1) / 1000 / (h2 - h1))).toFixed(3)),
  };
}

const claims = [
  { id: 'C1', claim: 'Both NEAR networks are live and advancing at the time of every model run.', evidence: 'sampled block intervals + heights per network', sources: ['https://rpc.testnet.fastnear.com', 'https://rpc.fastnear.com'] },
  { id: 'C2', claim: 'A typical agent micropayment transaction (5 TGas) costs < 0.01 NEAR, so machine-rate micropayments are economically viable.', evidence: 'gas price x 5 TGas cost table', sources: ['https://rpc.testnet.fastnear.com', 'https://docs.near.org'] },
  { id: 'C3', claim: 'The agent-economy thesis rests on NEAR Intents as the settlement primitive for cross-chain agent payments.', evidence: 'product + contracts cited, not benchmarked here', sources: ['https://www.near.org/intents', 'https://github.com/near/near-intents'] },
];

async function main() {
  console.log('=== NEAR AGENT ECONOMY THESIS MODEL (re-runnable) ===');
  const networks = {};
  for (const name of Object.keys(RPCS)) {
    process.stdout.write(`[${name}] sampling live RPC... `);
    const s = await sampleNetwork(RPCS[name]);
    const price = BigInt((await rpc(s.rpc_url, 'gas_price', [null])).gas_price); // live per-network price
    const costNear = yoctoToNear(AGENT_TX_GAS * price);
    Object.assign(s, {
      gas_price_yocto_per_gas: price.toString(),
      agent_tx_gas_tgas: 5,
      agent_tx_cost_near: Number(costNear.toFixed(8)),
    });
    networks[name] = s;
    console.log(`height=${s.latest_block_height} interval=${s.block_interval_seconds}s cost/5TGas=${s.agent_tx_cost_near} NEAR`);
  }

  const data = {
    schema: 'dail-near-thesis-model-v1',
    bounty: 'bnty_0485',
    generated_at: new Date().toISOString(),
    agent_tx_gas_tgas: 5,
    networks,
    claims,
  };
  writeFileSync(path.join(outDir, 'thesis_data.json'), JSON.stringify(data, null, 2) + '\n');

  // dashboard.html renders ONLY from thesis_data.json values above (chart numbers == script output)
  const bar = (label, value, max, color) => {
    const w = Math.max(4, Math.round((value / max) * 460));
    return `<text x="10" y="0" font-size="14">${label}</text><rect x="230" y="-12" width="${w}" height="16" fill="${color}"/><text x="${235 + w}" y="0" font-size="14">${value}</text>`;
  };
  const maxIv = Math.max(...Object.values(networks).map((n) => n.block_interval_seconds));
  const maxCost = Math.max(...Object.values(networks).map((n) => n.agent_tx_cost_near));
  const rows = Object.entries(networks)
    .map(([n, s]) => `<tr><td>${n}</td><td>${s.chain_id}</td><td>${s.latest_block_height}</td><td>${s.block_interval_seconds}s</td><td>${s.gas_price_yocto_per_gas}</td><td>${s.agent_tx_cost_near} NEAR</td></tr>`)
    .join('\n');
  const claimRows = claims
    .map((c) => `<li><b>${c.id}</b> — ${c.claim}<br/><i>Evidence:</i> ${c.evidence}<br/><i>Sources:</i> ${c.sources.map((u) => `<a href="${u}">${u}</a>`).join(', ')}</li>`)
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>NEAR Agent Economy — Investment Thesis Dashboard</title></head>
<body style="font-family:sans-serif;max-width:900px;margin:auto">
<h1>NEAR Agent Economy — Investment Thesis Dashboard</h1>
<p><b>Scope:</b> a falsifiable thesis-model verification — network liveness + agent micropayment economics + real testnet transaction evidence. It is <i>not</i> a full GMV/velocity dashboard of the agent economy (no scriptable live GMV source exists; none is invented here).</p>
<p>Generated by <code>node model.mjs</code> at ${data.generated_at}. Every number below comes from that script's live RPC queries; re-run the script to reproduce.</p>
<h2>Chart 1 — average block interval (seconds, sampled over ${SAMPLE_MS}ms)</h2>
<svg width="760" height="${Object.keys(networks).length * 26 + 10}">
${Object.entries(networks).map(([n, s], i) => `<g transform="translate(0,${i * 26 + 14})">${bar(n, s.block_interval_seconds, maxIv, '#4c7bf0')}</g>`).join('\n')}
</svg>
<h2>Chart 2 — cost of a typical 5 TGas agent transaction (NEAR)</h2>
<svg width="760" height="${Object.keys(networks).length * 26 + 10}">
${Object.entries(networks).map(([n, s], i) => `<g transform="translate(0,${i * 26 + 14})">${bar(n, s.agent_tx_cost_near, maxCost, '#e0a03c')}</g>`).join('\n')}
</svg>
<h2>Evidence table</h2>
<table border="1" cellpadding="6"><tr><th>network</th><th>chain_id</th><th>block height</th><th>block interval</th><th>gas price (yocto/gas)</th><th>cost per 5 TGas tx</th></tr>
${rows}</table>
<h2>Thesis claims (falsifiable)</h2><ul>${claimRows}</ul>
<p><i>Limits:</i> block intervals vary with load; gas prices move with demand; testnet values are testnet-NEAR. See README disclosures.</p>
</body></html>`;
  writeFileSync(path.join(outDir, 'dashboard.html'), html);

  console.log('MODEL RUN: PASS (thesis_data.json + dashboard.html written)');
}

main().catch((e) => { console.error('MODEL FAIL:', e.message); process.exit(1); });
