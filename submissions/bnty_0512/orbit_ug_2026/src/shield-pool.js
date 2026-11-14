// Shielded payment pool.
//
// A shielded job's escrow never records the amount. The pool only holds a
// COMMITMENT to the amount; the funds themselves sit in the pool's account and
// are indistinguishable from other shielded escrows. When the job completes, the
// recipient reveals (amount, nonce, blinding factor); the pool checks the reveal
// against the commitment it stored and only then pays out.
//
// Consequence: the amount is public only *after* completion. Before that, the
// chain contains a hash and nothing else.
//
// The pool is funded in fixed-size chunks so that the size of a funding transfer
// does not reveal the size of an individual escrow.
import { openCommitment } from './privacy.js';

export const POOL_CONTRACT_ID = 'shield-pool.near';
export const POOL_ACCOUNT = 'shield-pool.near';
export const FUNDING_CHUNK = 1_000_000; // 1 NEAR per chunk

export class ShieldPoolContract {
  constructor({ id = POOL_CONTRACT_ID } = {}) {
    this.id = id;
    this.escrows = new Map(); // escrow_id -> { escrow_id, commitment, status }
    this.chunks = 0;
  }

  methods = {
    /** Register a shielded escrow. Only the commitment is stored. */
    open_escrow: async ({ args }) => {
      const { escrow_id, commitment } = args;
      if (!escrow_id || !commitment) return { ok: false, error: 'escrow_id and commitment required' };
      if (this.escrows.has(escrow_id)) return { ok: false, error: 'escrow exists' };
      this.escrows.set(escrow_id, { escrow_id, commitment, status: 'funded', paid: 0 });
      return { ok: true, escrow_id };
    },

    /**
     * Pay out a shielded escrow. The reveal must open the commitment that was
     * registered when the escrow was opened. The pool never learns the amount
     * before this call.
     *
     * `splits` are the recipients and amounts, decided at reveal time (e.g. the
     * winner's payout plus the market fee). Their sum must equal the revealed
     * amount, otherwise the pool rejects the payout.
     */
    payout_split: async ({ args, chain }) => {
      const { escrow_id, splits, reveal } = args;
      const escrow = this.escrows.get(escrow_id);
      if (!escrow) return { ok: false, error: 'no such escrow' };
      if (escrow.status === 'paid') return { ok: false, error: 'already paid' };
      if (!reveal) return { ok: false, error: 'no reveal' };
      if (!openCommitment(escrow.commitment, reveal)) {
        return { ok: false, error: 'reveal does not open the commitment' };
      }
      if (!Number.isInteger(reveal.amount) || reveal.amount <= 0) {
        return { ok: false, error: 'bad amount' };
      }
      const total = splits.reduce((a, s) => a + s.amount, 0);
      if (total !== reveal.amount) {
        return { ok: false, error: `splits sum to ${total}, expected ${reveal.amount}` };
      }
      const balance = await chain.getBalance(this.id);
      if (balance < total) return { ok: false, error: 'pool underfunded' };
      for (const split of splits) {
        if (split.amount <= 0) continue;
        await chain.transfer({
          from: this.id,
          to: split.recipient,
          amount: split.amount,
          memo: `shielded ${escrow_id}`,
        });
      }
      escrow.status = 'paid';
      escrow.paid = reveal.amount;
      return { ok: true, escrow_id, paid: reveal.amount, splits: splits.length };
    },
  };

  views = {
    /** Public view: commitment and status only -- never the amount. */
    get_escrow: ({ args }) => {
      const e = this.escrows.get(args.escrow_id);
      if (!e) return null;
      return { escrow_id: e.escrow_id, commitment: e.commitment, status: e.status };
    },
    get_escrows: () =>
      [...this.escrows.values()].map((e) => ({
        escrow_id: e.escrow_id,
        commitment: e.commitment,
        status: e.status,
      })),
    get_funding_chunks: () => this.chunks,
  };
}
