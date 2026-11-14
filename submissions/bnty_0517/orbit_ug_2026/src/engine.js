// The engine: wallets, funding, spend requests, holds, approvals and reclaims.
//
// Every action is recorded in a hash-chained event log, and every decision
// carries the trace of the rules it went through.
import { hash } from './util.js';
import { evaluate, ruleOf } from './policy.js';
import { screenInstruction } from './scam.js';

export function emit(state, type, payload) {
  const seq = state.eventCount;
  const body = { seq, type, payload, prevHash: state.lastHash };
  const digest = hash(body);
  const event = { ...body, hash: digest };
  state.eventCount += 1;
  state.events.push(event);
  state.lastHash = digest;
  return event;
}

export function createWallet(state, {
  owner,
  label,
  kind = 'parent',
  parent = null,
  allowance = null,
  counterpartyAllow = [],
  categories = null,
  dustFloor = null,
  timestamp,
}) {
  if (!state.parties[owner]) throw new Error('the owner is not a registered party');
  if (kind === 'sandbox') {
    if (!parent) throw new Error('a sandbox needs a parent wallet');
    if (!(allowance > 0)) throw new Error('a sandbox needs a positive allowance');
  }
  const id = `wal_${hash({ owner, label, kind, parent, timestamp }).slice(0, 16)}`;
  const wallet = {
    id,
    owner,
    label,
    kind,
    parent,
    allowance,
    balance: 0,
    counterpartyAllow: kind === 'sandbox' ? counterpartyAllow : [],
    categories,
    dustFloor: dustFloor ?? (kind === 'sandbox' ? ruleOf(state.policy, 'dustFloor')?.floor ?? 0 : 0),
    createdAt: timestamp,
  };
  state.wallets[id] = wallet;
  state.walletOrder.push(id);
  emit(state, 'wallet_created', { id, owner, label, kind, allowance, parent });
  return wallet;
}

export function fundWallet(state, { walletId, from, amount, timestamp }) {
  const wallet = state.wallets[walletId];
  if (!wallet) throw new Error('unknown wallet');
  if (!(amount > 0)) throw new Error('the funding amount must be positive');
  if (wallet.kind === 'sandbox') {
    if (wallet.balance + amount > wallet.allowance) {
      throw new Error(
        `the sandbox allowance is ${wallet.allowance}, it holds ${wallet.balance} and cannot take ${amount}`,
      );
    }
    const parent = state.wallets[wallet.parent];
    if (!parent) throw new Error('the parent wallet is missing');
    if (parent.balance < amount) {
      throw new Error(`the parent wallet holds ${parent.balance}, it cannot fund ${amount}`);
    }
    parent.balance -= amount;
  } else {
    if (state.balances[from] < amount) {
      throw new Error(`${state.parties[from]?.name ?? from} holds ${state.balances[from]}, it cannot fund ${amount}`);
    }
    state.balances[from] -= amount;
  }
  wallet.balance += amount;
  emit(state, 'wallet_funded', { id: walletId, from, amount, balance: wallet.balance });
  return wallet;
}

// What the wallet has already spent, inside a rolling window.
export function windowSpend(state, wallet, timestamp, windowSeconds) {
  const since = timestamp - windowSeconds;
  let total = 0;
  for (const event of state.events) {
    if (event.type !== 'spend_executed') continue;
    if (event.payload.walletId !== wallet.id) continue;
    if (event.payload.timestamp < since) continue;
    total += event.payload.amount;
  }
  return total;
}

export function counterpartySpend(state, wallet, to) {
  let total = 0;
  for (const event of state.events) {
    if (event.type !== 'spend_executed') continue;
    if (event.payload.walletId !== wallet.id) continue;
    if (event.payload.to !== to) continue;
    total += event.payload.amount;
  }
  return total;
}

function execute(state, wallet, to, amount, timestamp) {
  wallet.balance -= amount;
  state.balances[to] = (state.balances[to] ?? 0) + amount;
  emit(state, 'spend_executed', { walletId: wallet.id, to, amount, timestamp, balance: wallet.balance });
}

export function requestSpend(state, {
  walletId,
  to,
  amount,
  category,
  note = null,
  instruction = null,
  timestamp,
}) {
  const wallet = state.wallets[walletId];
  if (!wallet) throw new Error('unknown wallet');
  if (wallet.kind !== 'sandbox') {
    throw new Error('the parent wallet is not spendable by the agent - only a sandbox is');
  }
  if (!state.parties[to]) throw new Error('the counterparty is not a registered party');
  if (!(amount > 0)) throw new Error('the amount must be positive');

  const limit = ruleOf(state.policy, 'perTransaction')?.limit;
  const screen = instruction
    ? screenInstruction(instruction, {
        limit,
        allowlist: wallet.counterpartyAllow,
        scamList: state.scamList || [],
      })
    : { flagged: false, score: 0, signals: [], threshold: 4, decision: 'PASS' };

  const evaluation = evaluate(state, {
    wallet,
    to,
    amount,
    category,
    spentInWindow: windowSpend(state, wallet, timestamp, ruleOf(state.policy, 'perWindow')?.windowSeconds ?? 86400),
    spentWithCounterparty: counterpartySpend(state, wallet, to),
  });

  let decision = evaluation.decision;
  let reason = evaluation.reason;
  if (decision === 'CLAMP' && evaluation.amount === 0) {
    decision = 'BLOCK';
    reason = 'the sandbox has nothing spendable above the dust floor';
  }
  if (decision !== 'BLOCK' && screen.hardBlock) {
    decision = 'BLOCK';
    reason = `the instruction is refused outright: ${screen.signals.map((signal) => signal.id).join(', ')}`;
  } else if (decision !== 'BLOCK' && screen.flagged) {
    decision = 'HOLD';
    reason = `the instruction carries scam signals: ${screen.signals.map((signal) => signal.id).join(', ')}`;
  }

  const request = {
    id: `req_${hash({ walletId, to, amount, timestamp, reason }).slice(0, 16)}`,
    walletId,
    to,
    amount: evaluation.amount,
    requested: amount,
    category,
    note,
    decision,
    reason,
    screen,
    evaluation,
    timestamp,
    status: 'DECIDED',
    approver: null,
    resolvedAt: null,
  };

  if (decision === 'ALLOW' || (decision === 'CLAMP' && evaluation.amount > 0)) {
    execute(state, wallet, to, evaluation.amount, timestamp);
    request.status = 'EXECUTED';
    emit(state, 'spend_executed_request', { id: request.id, walletId, to, amount: evaluation.amount, timestamp });
  } else if (decision === 'HOLD') {
    request.status = 'HELD';
    state.pending.push(request);
    emit(state, 'spend_held', { id: request.id, walletId, to, amount: evaluation.amount, reason });
  } else {
    request.status = 'BLOCKED';
    emit(state, 'spend_blocked', { id: request.id, walletId, to, amount: evaluation.amount, reason });
  }
  return request;
}

// An approval clears the SCAM hold - it does not override the policy. The
// request is evaluated again when it is approved.
export function approveSpend(state, { requestId, approver, approve, timestamp }) {
  const index = state.pending.findIndex((request) => request.id === requestId);
  if (index === -1) throw new Error('unknown request');
  const request = state.pending[index];
  state.pending.splice(index, 1);
  request.approver = approver;
  request.resolvedAt = timestamp;

  if (!approve) {
    request.status = 'REJECTED';
    request.reason = 'the owner rejected the request';
    emit(state, 'spend_rejected', { id: request.id, approver, timestamp });
    return request;
  }

  const wallet = state.wallets[request.walletId];
  const evaluation = evaluate(state, {
    wallet,
    to: request.to,
    amount: request.amount,
    category: request.category,
    spentInWindow: windowSpend(state, wallet, timestamp, ruleOf(state.policy, 'perWindow')?.windowSeconds ?? 86400),
    spentWithCounterparty: counterpartySpend(state, wallet, request.to),
  });
  if (evaluation.decision === 'BLOCK') {
    request.status = 'BLOCKED';
    request.reason = `approved, but the policy still refuses it: ${evaluation.reason}`;
    request.evaluation = evaluation;
    emit(state, 'spend_blocked_after_approval', { id: request.id, approver, reason: request.reason, timestamp });
    return request;
  }
  if (evaluation.decision === 'CLAMP' && evaluation.amount === 0) {
    request.status = 'BLOCKED';
    request.reason = 'approved, but the sandbox has nothing spendable above the dust floor';
    request.evaluation = evaluation;
    emit(state, 'spend_blocked_after_approval', { id: request.id, approver, reason: request.reason, timestamp });
    return request;
  }
  request.amount = evaluation.amount;
  request.evaluation = evaluation;
  request.status = 'EXECUTED';
  execute(state, wallet, request.to, evaluation.amount, timestamp);
  emit(state, 'spend_executed', { walletId: wallet.id, to: request.to, amount: evaluation.amount, timestamp, balance: wallet.balance });
  return request;
}

// The owner pulls money back out of a sandbox - but never below the dust
// floor, and never more than the sandbox holds.
export function reclaim(state, { walletId, to, timestamp }) {
  const wallet = state.wallets[walletId];
  if (!wallet) throw new Error('unknown wallet');
  if (wallet.kind !== 'sandbox') throw new Error('a parent wallet is not reclaimed this way');
  const floor = wallet.dustFloor ?? 0;
  const amount = Math.max(0, wallet.balance - floor);
  if (amount === 0) throw new Error(`the sandbox holds ${wallet.balance}; the dust floor is ${floor}`);
  wallet.balance -= amount;
  state.balances[to] = (state.balances[to] ?? 0) + amount;
  emit(state, 'reclaimed', { walletId, to, amount, kept: wallet.balance, timestamp });
  return { wallet, amount, kept: wallet.balance };
}

export function inspectWallet(state, { walletId, timestamp }) {
  const wallet = state.wallets[walletId];
  if (!wallet) throw new Error('unknown wallet');
  const window = ruleOf(state.policy, 'perWindow')?.windowSeconds ?? 86400;
  return {
    id: wallet.id,
    label: wallet.label,
    kind: wallet.kind,
    owner: wallet.owner,
    balance: wallet.balance,
    allowance: wallet.allowance,
    remaining: wallet.allowance === null ? null : wallet.allowance - wallet.balance,
    dustFloor: wallet.dustFloor,
    categories: wallet.categories,
    counterpartyAllow: wallet.counterpartyAllow,
    spentInWindow: windowSpend(state, wallet, timestamp, window),
    spentWithCounterparty: {},
    policy: state.policy.version,
    rules: state.policy.rules.map((rule) => ({ id: rule.id, kind: rule.kind })),
  };
}

// Nothing is created or destroyed: the owner's balance plus every wallet
// balance is constant.
export function audit(state) {
  const inWallets = state.walletOrder.reduce((sum, id) => sum + state.wallets[id].balance, 0);
  const inParties = state.partyOrder.reduce((sum, address) => sum + state.balances[address], 0);
  const total = state.total;
  return {
    inWallets,
    inParties,
    total,
    conserved: Math.abs(inWallets + inParties - total) < 1e-9,
    sandboxBalances: state.walletOrder
      .filter((id) => state.wallets[id].kind === 'sandbox')
      .map((id) => ({ id, balance: state.wallets[id].balance, allowance: state.wallets[id].allowance })),
  };
}
