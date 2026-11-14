// Chain abstraction.
//
// `NearChain` is the interface every other module talks to. Two implementations:
//   * `LocalChain`   -- in-process simulator of NEAR accounts + contract calls.
//                       Fully offline, fully deterministic. This is what the demo uses.
//   * `NearRpcChain` -- talks to a real NEAR JSON-RPC endpoint (testnet by default)
//                       for *read* calls. State-changing calls are refused on purpose:
//                       submitting a signed transaction needs a keypair/borsh signer
//                       library, and this repo ships zero dependencies.
//
// Every method is async so the two implementations are interchangeable.
import { canonical, sha256 } from './util.js';

export class NearChain {
  constructor(kind) {
    this.kind = kind;
  }

  /** @returns {Promise<number>} balance in uNEAR */
  async getBalance() {
    throw new Error('NearChain.getBalance not implemented');
  }

  /** Read-only contract call (view function). */
  async viewCall() {
    throw new Error('NearChain.viewCall not implemented');
  }

  /** State-changing contract call, signed by `signer`. */
  async callFunction() {
    throw new Error('NearChain.callFunction not implemented');
  }

  /** Transfer uNEAR between accounts. */
  async transfer() {
    throw new Error('NearChain.transfer not implemented');
  }
}

/**
 * Offline NEAR-like chain: named accounts with balances, deployed contracts with
 * view + change methods, deterministic transaction hashes and a receipt log.
 */
export class LocalChain extends NearChain {
  constructor({ seed = 'near-local' } = {}) {
    super('local');
    this.seed = seed;
    this.accounts = new Map(); // accountId -> { id, balance, sequence }
    this.contracts = new Map(); // contractId -> { id, methods, views }
    this.receipts = [];
    this.blockHeight = 0;
    this.seq = 0;
  }

  createAccount(id, balance = 0) {
    if (this.accounts.has(id)) throw new Error(`account already exists: ${id}`);
    this.accounts.set(id, { id, balance, sequence: 0 });
    return this.accounts.get(id);
  }

  getAccount(id) {
    const account = this.accounts.get(id);
    if (!account) throw new Error(`no such account: ${id}`);
    return account;
  }

  async getBalance(accountId) {
    return this.getAccount(accountId).balance;
  }

  /** Deploy a contract object: { id, methods: {...}, views: {...} }. */
  deployContract(contract) {
    if (this.contracts.has(contract.id)) throw new Error(`contract already exists: ${contract.id}`);
    this.contracts.set(contract.id, contract);
    this.createAccount(contract.id, 0);
    return contract;
  }

  async transfer({ from, to, amount, memo = '' }) {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error(`invalid amount: ${amount}`);
    const sender = this.getAccount(from);
    const receiver = this.getAccount(to);
    if (sender.balance < amount) throw new Error(`insufficient balance: ${from}`);
    sender.balance -= amount;
    receiver.balance += amount;
    this.receipts.push({
      type: 'transfer',
      from,
      to,
      amount,
      memo,
      block: this.blockHeight,
    });
    return { ok: true, from, to, amount };
  }

  /** Deterministic transaction hash, in the spirit of NEAR's tx hashes. */
  txHash({ contractId, method, args, signer, seq }) {
    return sha256(canonical({ contractId, method, args, signer, seq, seed: this.seed }));
  }

  async callFunction({ contractId, method, args = {}, signer, attachedDeposit = 0 }) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new Error(`no such contract: ${contractId}`);
    const fn = contract.methods[method];
    if (!fn) throw new Error(`contract ${contractId} has no method ${method}`);
    const account = this.getAccount(signer);
    if (attachedDeposit > account.balance) throw new Error(`insufficient balance: ${signer}`);
    account.balance -= attachedDeposit;
    account.sequence += 1;
    this.seq += 1;
    this.blockHeight += 1;

    const result = await fn({
      args,
      signer,
      chain: this,
      attachedDeposit,
      blockHeight: this.blockHeight,
    });
    const hash = this.txHash({ contractId, method, args, signer, seq: account.sequence });
    this.receipts.push({
      type: 'call',
      contractId,
      method,
      signer,
      attachedDeposit,
      hash,
      block: this.blockHeight,
      outcome: result && result.ok === false ? 'failure' : 'success',
    });
    return { hash, result };
  }

  async viewCall({ contractId, method, args = {} }) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new Error(`no such contract: ${contractId}`);
    const fn = contract.views && contract.views[method];
    if (!fn) throw new Error(`contract ${contractId} has no view ${method}`);
    return fn({ args, chain: this });
  }
}

/**
 * Read-only client for a real NEAR JSON-RPC node.
 *
 * Env vars (never committed, never required for the offline demo):
 *   NEAR_RPC_URL       e.g. https://rpc.testnet.near.org
 *   NEAR_ACCOUNT_ID    the account that owns the contract
 *   NEAR_CONTRACT_ID   the contract to read
 *
 * State-changing calls are refused: signing requires a borsh tx builder + keypair
 * library, and this repository ships zero dependencies on purpose. The honest
 * statement is "reads work against real NEAR, writes are simulated".
 */
export class NearRpcChain extends NearChain {
  constructor({ rpcUrl, accountId, contractId, fetchImpl = globalThis.fetch } = {}) {
    super('near-rpc');
    this.rpcUrl = rpcUrl;
    this.accountId = accountId;
    this.contractId = contractId;
    this.fetch = fetchImpl;
  }

  /** Build from environment; returns null when the env is not configured. */
  static fromEnv(env = process.env) {
    const rpcUrl = env.NEAR_RPC_URL;
    const accountId = env.NEAR_ACCOUNT_ID;
    const contractId = env.NEAR_CONTRACT_ID;
    if (!rpcUrl || !accountId || !contractId) return null;
    return new NearRpcChain({ rpcUrl, accountId, contractId });
  }

  async rpc(method, params) {
    if (!this.fetch) throw new Error('no fetch implementation available');
    const res = await this.fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`NEAR RPC ${method} failed: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`NEAR RPC ${method} error: ${body.error.message}`);
    return body.result;
  }

  /** Returns the balance in yoctoNEAR as a string (NEAR amounts exceed Number precision). */
  async getBalance(accountId = this.accountId) {
    const result = await this.rpc('query', {
      request_type: 'view_account',
      account_id: accountId,
      finality: 'final',
    });
    return String(result.amount);
  }

  async viewCall({ contractId = this.contractId, method, args = {} }) {
    const bytes = Buffer.from(canonical(args), 'utf8').toString('base64');
    const outcome = await this.rpc('query', {
      request_type: 'call_function',
      account_id: contractId,
      method_name: method,
      args_base64: bytes,
      finality: 'final',
    });
    const decoded = Buffer.from(outcome.result, 'base64').toString('utf8');
    return JSON.parse(decoded);
  }

  async callFunction() {
    throw new Error(
      'NearRpcChain.callFunction is intentionally not implemented: signing a NEAR ' +
        'transaction needs a borsh tx builder and keypair library, and this repo ' +
        'ships zero dependencies. Use LocalChain for the write path.',
    );
  }

  async transfer() {
    throw new Error('NearRpcChain.transfer is intentionally not implemented (see callFunction).');
  }
}
