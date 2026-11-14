// A double-entry journal. Every movement of value in ANCHOR posts two legs
// that balance, so the ledger can always be audited: the sum of the debits
// equals the sum of the credits, account by account.
//
// This is the deliberate difference from a balances map: positions are not
// "a number in a dict", they are the net of a trail of journal entries that a
// reviewer can read line by line.
import { round } from './util.js';

export function createLedger() {
  return { accounts: {}, entries: [], sequence: 0 };
}

// post(ledger, { legs: [{ account, debit, credit }], memo })
export function post(ledger, { legs, memo, assetId = null, holder = null, timestamp = null }) {
  let debit = 0;
  let credit = 0;
  for (const leg of legs) {
    debit += leg.debit || 0;
    credit += leg.credit || 0;
    ledger.accounts[leg.account] = round((ledger.accounts[leg.account] || 0) + (leg.debit || 0) - (leg.credit || 0), 8);
  }
  if (round(debit - credit, 8) !== 0) {
    throw new Error(`unbalanced journal entry: debit ${debit} vs credit ${credit}`);
  }
  const entry = {
    seq: ledger.sequence,
    memo,
    assetId,
    holder,
    timestamp,
    legs: legs.map((l) => ({ account: l.account, debit: round(l.debit || 0, 8), credit: round(l.credit || 0, 8) })),
    debit: round(debit, 8),
    credit: round(credit, 8),
  };
  ledger.entries.push(entry);
  ledger.sequence += 1;
  return entry;
}

// The audit: every account's balance is the debits minus the credits posted
// against it, and the two sides of the journal agree.
export function auditLedger(ledger) {
  let debit = 0;
  let credit = 0;
  for (const entry of ledger.entries) {
    debit += entry.debit;
    credit += entry.credit;
  }
  const accounts = {};
  for (const entry of ledger.entries) {
    for (const leg of entry.legs) {
      accounts[leg.account] = round((accounts[leg.account] || 0) + leg.debit - leg.credit, 8);
    }
  }
  const mismatched = Object.keys(accounts).filter(
    (a) => Math.abs((ledger.accounts[a] || 0) - accounts[a]) > 1e-9,
  );
  return {
    ok: round(debit - credit, 8) === 0 && mismatched.length === 0,
    debit: round(debit, 8),
    credit: round(credit, 8),
    accounts,
    mismatched,
  };
}
