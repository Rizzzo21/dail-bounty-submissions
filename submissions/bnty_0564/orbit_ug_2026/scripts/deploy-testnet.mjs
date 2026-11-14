#!/usr/bin/env node
// deploy-testnet.mjs — deploy the BLIND-ESCROW contract to NEAR testnet and run the real
// confidential-escrow flow, recording every transaction hash.
//
//   node scripts/deploy-testnet.mjs --inputs docs/engagement-inputs.json --out docs/deployment.json
//
// The script is IDEMPOTENT: every step is skipped if it has already happened, so it can be
// re-run after new inputs are available without duplicating on-chain state.
//
// NOTHING here is faked. Every hash printed comes from the network, and every value that the
// README quotes is read back from the chain (view calls) rather than from local memory.
//
// Order of the on-chain story (this is the order the README tells):
//   1. open_job     - only C, the ciphertext and the IV are published
//   2. NEGATIVE     - a settle with a FORGED blinding factor is refused (the commitment check)
//   3. settle       - the correct opening is accepted; the amount becomes public and the
//                     worker is paid out of the pool  <- the "atomic reveal"
//   4. cross-check  - the contract's own SHA-256 of the preimage equals sha256sum of the same bytes

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, nearToYocto } from 'near-api-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CRED_DIR = path.join(os.homedir(), '.near-credentials', 'testnet');
// rpc.testnet.near.org now answers HTTP 429 ("THIS ENDPOINT IS DEPRECATED! ... switch to
// https://fastnear.com"), so the primary endpoint is rpc.testnet.fastnear.com.
const NODE_URL = 'https://rpc.testnet.fastnear.com';
const EXPLORER = 'https://nearblocks.io';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const INPUTS = path.resolve(ROOT, arg('--inputs', 'docs/engagement-inputs.json'));
const OUT = path.resolve(ROOT, arg('--out', 'docs/deployment.json'));
const WASM = path.resolve(ROOT, 'contract/target/wasm32-unknown-unknown/release/blind_escrow.wasm');

const SPONSOR = 'orbit-anchor.testnet';
const CONTRACT = 'blind-escrow-orbit.testnet';
const BUYER = 'blind-buyer-orbit.testnet';
const WORKER = 'blind-worker-orbit.testnet';

const provider = new JsonRpcProvider({ url: NODE_URL });

function credPath(id) { return path.join(CRED_DIR, `${id}.json`); }
function readCred(id) {
  const p = credPath(id);
  if (!fs.existsSync(p)) throw new Error(`no credential for ${id} at ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeCred(id, c) {
  fs.mkdirSync(CRED_DIR, { recursive: true });
  fs.writeFileSync(credPath(id), JSON.stringify(c, null, 2));
  fs.chmodSync(credPath(id), 0o600);
}
function accountFor(id) {
  const c = readCred(id);
  return new Account(id, provider, new KeyPairSigner(KeyPair.fromString(c.private_key)));
}
async function accountExists(id) {
  try {
    const r = await provider.query({
      request_type: 'view_account', account_id: id, finality: 'optimistic',
    });
    return !!r && typeof r.amount === 'string';
  } catch { return false; }
}
const txLink = (h) => `${EXPLORER}/tx/${h}`;
const addrLink = (a) => `${EXPLORER}/address/${a}`;

async function ensureAccount(id, nearToTransfer = '0.25') {
  if (await accountExists(id)) {
    console.log(`  [skip] ${id} already exists on-chain`);
    return readCred(id);
  }
  if (!fs.existsSync(credPath(id))) {
    const kp = KeyPair.fromRandom('ed25519');
    writeCred(id, {
      account_id: id,
      public_key: kp.getPublicKey().toString(),
      private_key: kp.toString(),
    });
    console.log(`  [key ] wrote a fresh ed25519 key for ${id}`);
  }
  const sponsor = accountFor(SPONSOR);
  const cred = readCred(id);
  const res = await sponsor.createAccount({
    newAccountId: id,
    publicKey: cred.public_key,
    nearToTransfer: nearToYocto(nearToTransfer),
  });
  const h = res.transaction.hash;
  console.log(`  [tx  ] created ${id}  ${h}`);
  console.log(`        explorer: ${txLink(h)}`);
  return { ...cred, create_tx: h };
}

// The sponsor itself can run dry (it created three accounts and paid for several top-ups), so the
// payer is picked from a list: the first one that can actually afford the transfer.
const PAYERS = [SPONSOR, 'orbit-ritual.testnet', 'orbit-buyer.testnet', 'orbit-passport.testnet'];
async function payFrom(receiverId, nearAmount) {
  for (const payer of PAYERS) {
    let acct;
    try { acct = accountFor(payer); } catch { continue; }
    const bal = await acct.getBalance();
    if (bal < nearToYocto(nearAmount)) {
      console.log(`  [info] payer ${payer} holds only ${bal} yoctoNEAR - skipping`);
      continue;
    }
    const res = await acct.transfer({ receiverId, amount: nearToYocto(nearAmount) });
    console.log(`  [tx  ] paid by ${payer}`);
    return res.transaction.hash;
  }
  throw new Error(`no payer among ${PAYERS.join(', ')} could fund ${receiverId}`);
}
async function ensureBalance(id, nearNeeded) {
  const bal = await accountFor(id).getBalance();
  if (bal >= nearToYocto(nearNeeded)) {
    console.log(`  [skip] ${id} already holds ${bal} yoctoNEAR`);
    return null;
  }
  const h = await payFrom(id, nearNeeded);
  console.log(`  [tx  ] top-up ${id} by ${nearNeeded} NEAR  ${h}`);
  console.log(`        explorer: ${txLink(h)}`);
  return h;
}

async function callView(contractId, methodName, args = {}) {
  const raw = await provider.query({
    request_type: 'call_function',
    account_id: contractId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    finality: 'optimistic',
  });
  return JSON.parse(Buffer.from(Buffer.from(raw.result, 'base64')).toString('utf8'));
}

// A state-changing call that is EXPECTED TO SUCCEED.
async function send(acct, contractId, methodName, args, deposit = '0') {
  // callFunctionRaw (not callFunction): v7's callFunction returns the DECODED VALUE and would
  // throw the transaction hash away - and the hash is what the bounty asks us to cite.
  const res = await acct.callFunctionRaw({
    contractId,
    methodName,
    args,
    deposit: nearToYocto(deposit),
    gas: '300000000000000',
    waitUntil: 'EXECUTED_OPTIMISTIC',
  });
  const outcome = res.status ? Object.keys(res.status)[0] : (res.final_execution_status ?? 'unknown');
  const failure = res.status && res.status.Failure ? JSON.stringify(res.status.Failure) : null;
  const hash = res.transaction.hash;
  console.log(`  [tx  ] ${methodName} ${hash}`);
  console.log(`        outcome: ${outcome}${failure ? ' FAILURE=' + failure : ''}`);
  console.log(`        explorer: ${txLink(hash)}`);
  return { hash, outcome, failure };
}

// A state-changing call that is EXPECTED TO FAIL. near-api-js throws on a failed tx and the
// thrown error carries NO hash, so the transaction is submitted raw instead: the RPC's
// send_transaction response carries BOTH the transaction hash and the execution status
// ({"Failure": {"ActionError": ...}}).
// 🔴 NEVER compute a NEAR tx hash locally - base58(sha256(signed.encode())) does NOT match what
// the network hashes, and a hand-computed hash is a dead explorer link. Take the hash from the RPC.
async function sendExpectFailure(acct, contractId, methodName, args) {
  const signed = await acct.createSignedTransaction({
    receiverId: contractId,
    // gas is in TGas (300 TGas = 300000000000000) - passing yoctoNEAR here silently produces a
    // transaction the network rejects with "Total prepaid gas ... exceeds limit".
    actions: [actions.functionCall(methodName, args, 300000000000000n, nearToYocto('0'))],
    signer: acct.signer,
  });
  const res = await provider.sendTransaction(signed);
  const hash = res.transaction.hash;
  const status = res.status ?? null;
  const failure = status && status.Failure ? JSON.stringify(status.Failure) : null;
  console.log(`  [tx  ] ${methodName} (expected to fail) ${hash}`);
  console.log(`        status: ${failure ? failure.slice(0, 220) : JSON.stringify(status).slice(0, 220)}`);
  console.log(`        explorer: ${txLink(hash)}`);
  return { hash, status, failure, refused: !!failure };
}

async function main() {
  const started = new Date().toISOString();
  console.log('=== BLIND-ESCROW deploy to NEAR testnet ===');
  console.log(`  node   : ${NODE_URL}`);
  console.log(`  inputs : ${INPUTS}`);
  if (!fs.existsSync(INPUTS)) throw new Error(`missing inputs file: ${INPUTS}`);
  const inputs = JSON.parse(fs.readFileSync(INPUTS, 'utf8'));
  console.log(`  job_id=${inputs.job_id}  amount_units=${inputs.amount_units}`);
  console.log(`  commitment=${inputs.commitment_hex}`);

  const state = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  state.contract = CONTRACT;
  state.buyer = BUYER;
  state.worker = WORKER;
  state.node_url = NODE_URL;
  state.explorer = EXPLORER;
  state.started_at = started;

  console.log('\n[1/7] accounts');
  state.accounts = {
    sponsor: SPONSOR,
    contract: (await ensureAccount(CONTRACT)).create_tx ?? null,
    buyer: (await ensureAccount(BUYER)).create_tx ?? null,
    worker: (await ensureAccount(WORKER)).create_tx ?? null,
  };

  console.log('\n[2/7] top up the accounts the flow needs');
  state.topups = {
    contract: await ensureBalance(CONTRACT, '3'),
    buyer: await ensureBalance(BUYER, '1'),
    worker: await ensureBalance(WORKER, '1'),
  };

  console.log('\n[3/7] deploy the contract');
  let code = null;
  try {
    code = await accountFor(CONTRACT).getContractCode();
  } catch (e) {
    console.log(`  [info] no contract code yet (${String(e.message).slice(0, 70)})`);
  }
  if (code?.code?.length) {
    console.log('  [skip] contract code already deployed');
  } else {
    const wasm = fs.readFileSync(WASM);
    console.log(`  wasm : ${WASM} (${wasm.length} bytes)`);
    const res = await accountFor(CONTRACT).deployContract(new Uint8Array(wasm));
    const h = res.transaction.hash;
    state.deploy_tx = h;
    console.log(`  [tx  ] deploy ${h}`);
    console.log(`        explorer: ${txLink(h)}`);
  }
  const wasmSha = createHash('sha256').update(fs.readFileSync(WASM)).digest('hex');
  state.wasm_sha256 = wasmSha;
  console.log(`  wasm sha256: ${wasmSha}`);

  console.log('\n[4/7] fund the escrow pool');
  if (state.pool_funding_tx) {
    console.log(`  [skip] pool already funded (tx ${state.pool_funding_tx})`);
  } else {
    const h = await payFrom(CONTRACT, '2');
    state.pool_funding_tx = h;
    console.log(`  [tx  ] pool funding 2 NEAR  ${h}`);
    console.log(`        explorer: ${txLink(h)}`);
  }
  state.pool_balance_after_funding = String(await callView(CONTRACT, 'pool_balance'));

  console.log('\n[5/7] open the confidential job (only C + ciphertext are published)');
  let job = await callView(CONTRACT, 'view_job', { job_id: inputs.job_id });
  if (job) {
    console.log(`  [skip] job ${inputs.job_id} already exists`);
  } else {
    const r = await send(accountFor(BUYER), CONTRACT, 'open_job', {
      job_id: inputs.job_id,
      commitment: inputs.commitment_b64,
      worker: WORKER,
      ciphertext: inputs.ciphertext_b64,
      iv: inputs.iv_b64,
    });
    if (r.failure) throw new Error('open_job failed: ' + r.failure);
    state.open_job_tx = r.hash;
  }
  job = await callView(CONTRACT, 'view_job', { job_id: inputs.job_id });
  console.log('  on-chain job:', JSON.stringify(job));
  state.job_after_open = job;

  console.log('\n[6/7] NEGATIVE CASE — settle with a FORGED blinding factor (must be refused)');
  const wrongBf = inputs.blinding_hex.slice(0, 63) + (inputs.blinding_hex[63] === 'a' ? 'b' : 'a');
  console.log(`  forged opening: ${wrongBf}`);
  const neg = await sendExpectFailure(accountFor(WORKER), CONTRACT, 'settle', {
    job_id: inputs.job_id,
    amount_units: inputs.amount_units,
    blinding_factor_hex: wrongBf,
  });
  state.negative_case_tx = neg.hash;
  state.negative_case_status = neg.status;
  state.negative_case_failure = neg.failure;
  state.negative_case_refused = neg.refused === true;
  console.log(`  refused as required: ${state.negative_case_refused}`);
  if (!state.negative_case_refused) throw new Error('the forged opening was NOT refused');

  console.log('\n[7/7] settle with the CORRECT opening (the amount becomes public here)');
  job = await callView(CONTRACT, 'view_job', { job_id: inputs.job_id });
  if (job?.opened) {
    console.log('  [skip] job already settled');
  } else {
    const r = await send(accountFor(WORKER), CONTRACT, 'settle', {
      job_id: inputs.job_id,
      amount_units: inputs.amount_units,
      blinding_factor_hex: inputs.blinding_hex,
    });
    if (r.failure) throw new Error('settle failed: ' + r.failure);
    state.settle_tx = r.hash;
  }
  job = await callView(CONTRACT, 'view_job', { job_id: inputs.job_id });
  console.log('  on-chain job after settle:', JSON.stringify(job));
  state.job_after_settle = job;

  console.log('\n=== cross-check: the contract SHA-256 vs an off-chain sha256 of the same bytes ===');
  const preimage = `${inputs.amount_units}|${inputs.blinding_hex}|${inputs.job_id}`;
  const onChain = await callView(CONTRACT, 'sha256_hex', { input: preimage });
  const offChain = createHash('sha256').update(preimage, 'utf8').digest('hex');
  console.log(`  preimage : ${preimage}`);
  console.log(`  on-chain: ${onChain}`);
  console.log(`  off-chain: ${offChain}`);
  console.log(`  match   : ${onChain === offChain ? 'YES' : 'NO *** MISMATCH ***'}`);
  state.crosscheck = {
    preimage, on_chain_sha256: onChain, off_chain_sha256: offChain, match: onChain === offChain,
  };

  // the worker really got paid - read the balance delta from the chain
  state.worker_balance = String(await accountFor(WORKER).getBalance());

  state.inputs = inputs;
  state.finished_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(state, null, 2) + '\n');
  console.log(`\nwrote ${OUT}`);
}

main().catch((e) => {
  console.error('DEPLOY FAILED:', e.message);
  process.exit(1);
});
