import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalChain, NearChain, NearRpcChain } from '../src/chain.js';
import { keypairFromSeed, sha256 } from '../src/util.js';

test('LocalChain is a NearChain', () => {
  const chain = new LocalChain({ seed: 't' });
  assert.ok(chain instanceof NearChain);
  assert.equal(chain.kind, 'local');
});

test('accounts hold and transfer balances', async () => {
  const chain = new LocalChain({ seed: 't' });
  chain.createAccount('a.near', 1_000);
  chain.createAccount('b.near', 0);
  await chain.transfer({ from: 'a.near', to: 'b.near', amount: 400 });
  assert.equal(await chain.getBalance('a.near'), 600);
  assert.equal(await chain.getBalance('b.near'), 400);
});

test('transfers above the balance are refused', async () => {
  const chain = new LocalChain({ seed: 't' });
  chain.createAccount('a.near', 100);
  chain.createAccount('b.near', 0);
  await assert.rejects(
    () => chain.transfer({ from: 'a.near', to: 'b.near', amount: 101 }),
    /insufficient balance/,
  );
});

test('an unknown account is an error', async () => {
  const chain = new LocalChain({ seed: 't' });
  await assert.rejects(() => chain.getBalance('nope.near'), /no such account/);
});

test('contract calls are dispatched and logged with a deterministic hash', async () => {
  const chain = new LocalChain({ seed: 't' });
  chain.createAccount('a.near', 100);
  chain.deployContract({
    id: 'c.near',
    methods: { ping: async ({ args }) => ({ ok: true, echo: args.value }) },
    views: { read: async ({ args }) => ({ value: args.value }) },
  });
  const { result } = await chain.callFunction({
    contractId: 'c.near',
    method: 'ping',
    args: { value: 7 },
    signer: 'a.near',
  });
  assert.deepEqual(result, { ok: true, echo: 7 });
  const receipt = chain.receipts.at(-1);
  assert.equal(receipt.method, 'ping');
  assert.equal(receipt.hash.length, 64);

  // same seed, same hash
  const chain2 = new LocalChain({ seed: 't' });
  chain2.createAccount('a.near', 100);
  chain2.deployContract({
    id: 'c.near',
    methods: { ping: async ({ args }) => ({ ok: true, echo: args.value }) },
    views: {},
  });
  const { hash } = await chain2.callFunction({
    contractId: 'c.near',
    method: 'ping',
    args: { value: 7 },
    signer: 'a.near',
  });
  assert.equal(hash, receipt.hash);
});

test('calling an unknown method or contract fails loudly', async () => {
  const chain = new LocalChain({ seed: 't' });
  chain.createAccount('a.near', 100);
  chain.deployContract({ id: 'c.near', methods: {}, views: {} });
  await assert.rejects(
    () => chain.callFunction({ contractId: 'c.near', method: 'nope', signer: 'a.near' }),
    /no method nope/,
  );
  await assert.rejects(
    () => chain.callFunction({ contractId: 'zzz.near', method: 'ping', signer: 'a.near' }),
    /no such contract/,
  );
});

test('views are read-only and do not cost gas', async () => {
  const chain = new LocalChain({ seed: 't' });
  chain.createAccount('a.near', 100);
  chain.deployContract({
    id: 'c.near',
    methods: {},
    views: { read: async ({ args }) => ({ value: args.value }) },
  });
  const out = await chain.viewCall({ contractId: 'c.near', method: 'read', args: { value: 3 } });
  assert.deepEqual(out, { value: 3 });
  assert.equal(chain.receipts.length, 0);
});

test('the abstract NearChain refuses everything', async () => {
  const chain = new NearChain('abstract');
  await assert.rejects(() => chain.getBalance('a'), /not implemented/);
  await assert.rejects(() => chain.viewCall({}), /not implemented/);
  await assert.rejects(() => chain.callFunction({}), /not implemented/);
});

test('NearRpcChain.fromEnv returns null without env vars', () => {
  assert.equal(NearRpcChain.fromEnv({}), null);
  const chain = NearRpcChain.fromEnv({
    NEAR_RPC_URL: 'https://rpc.testnet.near.org',
    NEAR_ACCOUNT_ID: 'a.near',
    NEAR_CONTRACT_ID: 'c.near',
  });
  assert.ok(chain instanceof NearRpcChain);
  assert.equal(chain.rpcUrl, 'https://rpc.testnet.near.org');
});

test('NearRpcChain refuses to pretend it can sign transactions', async () => {
  const chain = new NearRpcChain({ rpcUrl: 'http://x', accountId: 'a.near', contractId: 'c.near' });
  await assert.rejects(() => chain.callFunction({}), /intentionally not implemented/);
  await assert.rejects(() => chain.transfer({}), /intentionally not implemented/);
});

test('NearRpcChain issues a correct JSON-RPC view request', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      json: async () => ({
        result: { result: Buffer.from('{"value":42}').toString('base64') },
      }),
    };
  };
  const chain = new NearRpcChain({
    rpcUrl: 'https://rpc.testnet.near.org',
    accountId: 'a.near',
    contractId: 'c.near',
    fetchImpl: fakeFetch,
  });
  const out = await chain.viewCall({ method: 'get_job', args: { job_id: 'j' } });
  assert.deepEqual(out, { value: 42 });
  assert.equal(calls[0].body.method, 'query');
  assert.equal(calls[0].body.params.request_type, 'call_function');
  assert.equal(calls[0].body.params.method_name, 'get_job');
});

test('keypairs are deterministic and verifiable', () => {
  const a = keypairFromSeed(sha256('seed'));
  const b = keypairFromSeed(sha256('seed'));
  assert.equal(a.publicKeyHex, b.publicKeyHex);
  assert.equal(a.publicKeyHex.length, 64);
});
