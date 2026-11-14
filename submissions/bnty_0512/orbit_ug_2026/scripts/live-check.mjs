#!/usr/bin/env node
// OPTIONAL live check against the public NEAR testnet.
//
// This is the only script in the repository that touches the network, and it is
// NOT part of `docs/verify.sh` -- the offline demo and tests never call it.
//
//   node scripts/live-check.mjs
//   NEAR_RPC_URL=https://rpc.testnet.near.org node scripts/live-check.mjs
//
// It performs two genuine JSON-RPC reads against a public contract:
//   1. view_account on a named account -> balance
//   2. call_function on wrap.testnet    -> ft_metadata
//
// Nothing is signed and nothing is written: NearRpcChain cannot submit
// transactions (see src/chain.js for why).
import { NearRpcChain } from '../src/chain.js';

const rpcUrl = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
const probeAccount = process.env.NEAR_PROBE_ACCOUNT || 'test.near';
const probeContract = process.env.NEAR_PROBE_CONTRACT || 'wrap.testnet';

const chain = new NearRpcChain({
  rpcUrl,
  accountId: probeAccount,
  contractId: probeContract,
});

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '   [PASS]' : '   [FAIL]'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
};

console.log(`NEAR RPC: ${rpcUrl}`);

try {
  const balance = await chain.getBalance(probeAccount);
  check('view_account on ' + probeAccount, typeof balance === 'string' && balance.length > 0, `balance = ${balance} yoctoNEAR`);
} catch (err) {
  check('view_account on ' + probeAccount, false, err.message);
}

try {
  const metadata = await chain.viewCall({ method: 'ft_metadata', args: {} });
  const ok = metadata && metadata.symbol && metadata.decimals === 24;
  check('call_function ft_metadata on ' + probeContract, ok, `${metadata?.symbol} (${metadata?.decimals} decimals)`);
} catch (err) {
  check('call_function ft_metadata on ' + probeContract, false, err.message);
}

console.log('');
console.log('note: the offline demo (node scripts/demo.mjs) and the test suite');
console.log('      (node --test) need none of this. They run with no network.');
process.exit(failures === 0 ? 0 : 1);
