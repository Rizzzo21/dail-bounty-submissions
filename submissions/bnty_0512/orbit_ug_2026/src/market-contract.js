// The swarm market contract.
//
// This is the "on-chain" part of the entry: a NEAR-style contract with methods
// (state-changing) and views (read-only). It implements:
//
//   * a job market with a REPUTATION GATE  (agents below a score threshold cannot bid)
//   * first-price sealed bids with a deterministic winner rule
//   * a LEADERLESS CONSENSUS gate on the award (>2/3 of validators must sign the
//     same digest of the bid set; a validator signs only what it re-derives itself)
//   * escrow per job, with fees and job surplus becoming SOCIAL MONEY in a shared
//     treasury that funds collective purchases
//   * SHIELDED payment for private jobs (only a commitment is published)
//   * PRIVATE aggregation (agents publish only column sums of an additive secret
//     sharing; only the aggregate ever hits the chain)
//
// All money is integer uNEAR (1 NEAR = 1_000_000 uNEAR).
import { ReputationPassport, issuerKeypair } from './reputation.js';
import { ConsensusRound, quorumSize } from './consensus.js';
import { planCollectivePurchase } from './collective.js';
import { mod, openCommitment } from './privacy.js';
import { verifyWith } from './util.js';
import { computeBidDigest, selectWinner } from './rules.js';

export const CONTRACT_ID = 'swarm-market.near';
export const HOUSE_ACCOUNT = 'house.near';
export const FEE_BPS = 500; // 5% of the winning bid goes to the social-money pool
export const DEFAULT_QUALITY_FLOOR = 0.35; // below this the delivery counts as a default

const cmpIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export class SwarmMarketContract {
  constructor({
    id = CONTRACT_ID,
    issuerSeed = 'dail-house-issuer',
    poolContractId = 'shield-pool.near',
  } = {}) {
    this.id = id;
    this.poolContractId = poolContractId;
    this.issuer = issuerKeypair(issuerSeed);
    this.agents = new Map(); // agent_id -> { agent_id, public_key_hex, passport }
    this.jobs = new Map();
    this.escrows = new Map();
    this.purchases = new Map();
    this.privateRounds = new Map();
    this.votes = new Map(); // job_id -> { round, votes: Map }
    this.bids = new Map(); // job_id -> Map(agent_id -> bid)
    this.events = [];
  }

  // ---------------------------------------------------------------- helpers

  agent(agentId) {
    const a = this.agents.get(agentId);
    if (!a) throw new Error(`unknown agent: ${agentId}`);
    return a;
  }

  passportFor(agentId) {
    return this.agent(agentId).passport;
  }

  scoreOf(agentId) {
    return this.passportFor(agentId).score;
  }

  log(type, data) {
    this.events.push({ index: this.events.length, type, ...data });
  }

  /** Canonical digest of a job's bid set -- what validators sign. */
  bidDigest(jobId) {
    const job = this.jobs.get(jobId);
    return computeBidDigest(job, [...this.bids.get(jobId).values()]);
  }

  /**
   * Deterministic winner rule: highest quality first, then lowest price, then
   * agent id. Every validator computes this locally from the same bid set.
   */
  selectWinner(jobId) {
    return selectWinner([...this.bids.get(jobId).values()]);
  }

  // ---------------------------------------------------------------- methods

  methods = {
    register_agent: async ({ args, signer }) => {
      const { agent_id, public_key_hex } = args;
      if (!agent_id) return { ok: false, error: 'agent_id required' };
      if (!this.agents.has(agent_id)) {
        const passport = new ReputationPassport({ agentId: agent_id, issuer: 'dail-house' });
        passport.append('registered', { public_key_hex }, 0);
        this.agents.set(agent_id, { agent_id, public_key_hex, passport });
        this.log('agent_registered', { agent_id });
      }
      return { ok: true, agent_id, passport_id: this.passportFor(agent_id).id };
    },

    post_job: async ({ args, signer }) => {
      const {
        job_id,
        skill,
        budget,
        base_price,
        min_reputation = 0,
        min_quality = null,
        shielded = false,
        commitment = null,
      } = args;
      if (this.jobs.has(job_id)) return { ok: false, error: `job exists: ${job_id}` };
      if (!Number.isInteger(budget) || budget <= 0) return { ok: false, error: 'bad budget' };
      if (shielded && !commitment) {
        return { ok: false, error: 'shielded jobs need a commitment' };
      }
      this.jobs.set(job_id, {
        job_id,
        skill,
        budget,
        base_price,
        min_reputation,
        min_quality,
        shielded,
        commitment,
        status: 'open',
        winner: null,
        price: null,
        quality: null,
        escrow_id: null,
        rounds: 0,
      });
      this.bids.set(job_id, new Map());
      this.votes.set(job_id, { round: 0, votes: new Map() });
      this.log('job_posted', { job_id, skill, budget, min_reputation, shielded });
      return { ok: true, job_id };
    },

    bid: async ({ args, signer, chain }) => {
      const { job_id, price, quality, deliver_days = 3 } = args;
      const job = this.jobs.get(job_id);
      if (!job) return { ok: false, error: `no such job: ${job_id}` };
      if (job.status !== 'open') return { ok: false, error: `job not open: ${job_id}` };
      if (!this.agents.has(signer)) return { ok: false, error: `agent not registered: ${signer}` };
      if (!Number.isInteger(price) || price <= 0) return { ok: false, error: 'bad price' };
      if (price > job.budget) return { ok: false, error: 'price above budget' };
      if (!(quality >= 0 && quality <= 1)) return { ok: false, error: 'bad quality' };
      if (job.min_quality != null && quality < job.min_quality) {
        return { ok: false, error: 'quality floor' };
      }

      // THE REPUTATION GATE
      const score = this.scoreOf(signer);
      if (score < job.min_reputation) {
        this.log('bid_gated', { job_id, agent_id: signer, score, required: job.min_reputation });
        return {
          ok: false,
          error: 'reputation gate',
          score,
          required: job.min_reputation,
        };
      }
      const existing = this.bids.get(job_id).get(signer);
      if (existing && existing.price <= price) {
        return { ok: false, error: 'new bid must be cheaper' };
      }
      this.bids.get(job_id).set(signer, {
        agent_id: signer,
        price,
        quality,
        deliver_days,
        score,
      });
      this.log('bid_placed', { job_id, agent_id: signer, price, quality, score });
      return { ok: true, job_id, agent_id: signer, price, quality };
    },

    submit_vote: async ({ args, signer }) => {
      const { job_id, digest, signature } = args;
      const job = this.jobs.get(job_id);
      if (!job) return { ok: false, error: `no such job: ${job_id}` };
      const store = this.votes.get(job_id);
      const agent = this.agents.get(signer);
      if (!agent) return { ok: false, error: 'agent not registered' };
      const round = store.round + 1;
      const validators = [...this.agents.keys()].sort();
      const consensus = new ConsensusRound({ round, validators });
      const pk = Buffer.from(agent.public_key_hex, 'hex');
      if (!verifyWith(pk, digest, signature)) {
        return { ok: false, error: 'invalid vote signature' };
      }
      if (store.votes.has(signer)) return { ok: false, error: 'already voted' };
      store.votes.set(signer, { digest, signature, round });
      store.round = round;
      const counts = new Map();
      for (const v of store.votes.values()) counts.set(v.digest, (counts.get(v.digest) || 0) + 1);
      const quorum = quorumSize(validators.length);
      const agreed = [...counts.entries()].find(([, c]) => c >= quorum);
      this.log('vote_cast', { job_id, agent_id: signer, round, quorum });
      return {
        ok: true,
        job_id,
        round,
        votes: store.votes.size,
        quorum,
        agreed_digest: agreed ? agreed[0] : null,
      };
    },

    finalize_bidding: async ({ args, signer, chain }) => {
      const { job_id } = args;
      const job = this.jobs.get(job_id);
      if (!job) return { ok: false, error: `no such job: ${job_id}` };
      if (job.status !== 'open') return { ok: false, error: `job not open: ${job_id}` };
      const store = this.votes.get(job_id);
      const validators = [...this.agents.keys()].sort();
      const quorum = quorumSize(validators.length);
      const digest = this.bidDigest(job_id);
      const votesFor = [...store.votes.values()].filter((v) => v.digest === digest).length;
      if (votesFor < quorum) {
        this.log('consensus_failed', { job_id, votes_for: votesFor, quorum });
        return { ok: false, error: 'no consensus', votes_for: votesFor, quorum, digest };
      }
      const winner = this.selectWinner(job_id);
      if (!winner) return { ok: false, error: 'no bids' };

      // escrow the budget. A SHIELDED job is escrowed in the privacy pool: the
      // market contract records only the commitment, never the amount.
      const escrowId = `escrow:${job_id}`;
      if (job.shielded) {
        const pool = await chain.callFunction({
          contractId: this.poolContractId,
          method: 'open_escrow',
          args: { escrow_id: escrowId, commitment: job.commitment },
          signer: this.id,
        });
        if (!pool.result.ok) return { ok: false, error: `pool: ${pool.result.error}` };
        this.escrows.set(escrowId, {
          escrow_id: escrowId,
          job_id,
          amount: null, // never published
          paid: 0,
          status: 'funded',
          shielded: true,
          commitment: job.commitment,
        });
      } else {
        await chain.transfer({
          from: HOUSE_ACCOUNT,
          to: this.id,
          amount: job.budget,
          memo: `escrow ${job_id}`,
        });
        this.escrows.set(escrowId, {
          escrow_id: escrowId,
          job_id,
          amount: job.budget,
          paid: 0,
          status: 'funded',
          shielded: false,
          commitment: job.commitment,
        });
      }
      job.status = 'awarded';
      job.winner = winner.agent_id;
      job.price = winner.price;
      job.quality = winner.quality;
      job.escrow_id = escrowId;
      this.passportFor(winner.agent_id).append(
        'job_awarded',
        { job_id, price: winner.price, escrow_id: escrowId },
        job.rounds,
      );
      this.log('job_awarded', {
        job_id,
        winner: winner.agent_id,
        price: winner.price,
        quality: winner.quality,
        votes_for: votesFor,
        quorum,
      });
      return {
        ok: true,
        job_id,
        winner: winner.agent_id,
        price: winner.price,
        quality: winner.quality,
        escrow_id: escrowId,
        votes_for: votesFor,
        quorum,
        digest,
      };
    },

    settle_job: async ({ args, signer, chain }) => {
      const { job_id, delivered_quality, reveal = null } = args;
      const job = this.jobs.get(job_id);
      if (!job) return { ok: false, error: `no such job: ${job_id}` };
      if (job.status !== 'awarded') return { ok: false, error: `job not awarded: ${job_id}` };
      const escrow = this.escrows.get(job.escrow_id);

      const price = job.price;
      const quality = delivered_quality;
      const fee = Math.round((price * FEE_BPS) / 10000);
      const payout = price - fee;

      if (job.shielded) {
        // The escrow amount was never published. The reveal opens the commitment
        // and the privacy pool releases the funds. The amount becomes public only
        // here, at completion.
        if (!reveal) return { ok: false, error: 'shielded job needs a reveal' };
        if (!openCommitment(escrow.commitment, reveal)) {
          this.log('reveal_rejected', { job_id });
          return { ok: false, error: 'reveal does not match commitment' };
        }
        const surplus = reveal.amount - price;
        const payoutRes = await chain.callFunction({
          contractId: this.poolContractId,
          method: 'payout_split',
          args: {
            escrow_id: escrow.escrow_id,
            reveal,
            splits: [
              { recipient: job.winner, amount: payout },
              { recipient: this.id, amount: fee + surplus },
            ],
          },
          signer: this.id,
        });
        if (!payoutRes.result.ok) {
          return { ok: false, error: `pool payout: ${payoutRes.result.error}` };
        }
        escrow.revealed = true;
        escrow.surplus_to_social_money = surplus;
        escrow.paid = payout;
        escrow.fee = fee;
        escrow.status = 'settled';
        job.status = 'settled';
        this.log('shielded_reveal', {
          job_id,
          escrow_id: escrow.escrow_id,
          revealed_amount: reveal.amount,
          winner_payout: payout,
          fee,
          surplus_to_social_money: surplus,
        });
      } else {
        await chain.transfer({
          from: this.id,
          to: job.winner,
          amount: payout,
          memo: `settle ${job_id}`,
        });
        const surplus = escrow.amount - price;
        escrow.paid = payout;
        escrow.fee = fee;
        escrow.surplus_to_social_money = surplus;
        escrow.status = 'settled';
        job.status = 'settled';
      }

      const passport = this.passportFor(job.winner);
      if (quality >= DEFAULT_QUALITY_FLOOR) {
        passport.append(
          'job_settled',
          { job_id, price, quality, fee, escrow_id: escrow.id },
          job.rounds,
        );
      } else {
        passport.append(
          'job_defaulted',
          { job_id, price, quality, escrow_id: escrow.id },
          job.rounds,
        );
      }
      this.log('job_settled', {
        job_id,
        winner: job.winner,
        price,
        quality,
        fee,
        social_money_surplus: escrow.surplus_to_social_money,
        treasury: (await this.views.get_treasury({ args: {}, chain })).free_social_money,
      });
      return {
        ok: true,
        job_id,
        winner: job.winner,
        price,
        fee,
        quality,
        score: passport.score,
        treasury: (await this.views.get_treasury({ args: {}, chain })).free_social_money,
      };
    },

    // ---------------------------------------------------- collective buying

    open_purchase: async ({ args }) => {
      const { purchase_id, unit_base, units_target, tiers = [] } = args;
      if (this.purchases.has(purchase_id)) return { ok: false, error: 'purchase exists' };
      this.purchases.set(purchase_id, {
        purchase_id,
        unit_base,
        units_target,
        tiers,
        bids: new Map(),
        status: 'open',
        plan: null,
      });
      this.log('purchase_opened', { purchase_id, unit_base, units_target });
      return { ok: true, purchase_id };
    },

    bid_purchase: async ({ args, signer }) => {
      const { purchase_id, units, valuation_per_unit, max_spend } = args;
      const p = this.purchases.get(purchase_id);
      if (!p) return { ok: false, error: 'no such purchase' };
      if (p.status !== 'open') return { ok: false, error: 'purchase closed' };
      if (!this.agents.has(signer)) return { ok: false, error: 'agent not registered' };
      p.bids.set(signer, { agent_id: signer, units, valuation_per_unit, max_spend });
      this.log('purchase_bid', { purchase_id, agent_id: signer, units });
      return { ok: true, purchase_id, agent_id: signer, units };
    },

    settle_purchase: async ({ args, signer, chain }) => {
      const { purchase_id } = args;
      const p = this.purchases.get(purchase_id);
      if (!p) return { ok: false, error: 'no such purchase' };
      if (p.status !== 'open') return { ok: false, error: 'purchase closed' };
      const treasuryState = await this.views.get_treasury({ args: {}, chain });
      const treasury = treasuryState.free_social_money;
      const bids = [...p.bids.values()];
      const plan = planCollectivePurchase({
        treasury,
        subsidyCap: Math.floor(treasury / 2),
        unitBase: p.unit_base,
        tiers: p.tiers,
        bids,
      });
      if (!plan) {
        p.status = 'abandoned';
        return { ok: false, error: 'no viable collective purchase' };
      }
      // agents pay their share
      for (const alloc of plan.allocation) {
        if (alloc.cost > 0) {
          await chain.transfer({
            from: alloc.agent_id,
            to: this.id,
            amount: alloc.cost,
            memo: `collective ${purchase_id}`,
          });
        }
        this.passportFor(alloc.agent_id).append(
          'collective_purchase',
          { purchase_id, units: alloc.units, cost: alloc.cost },
          0,
        );
      }
      // The vendor is paid the gross amount; the difference is covered by the
      // social-money pool (the contract account), which is exactly the subsidy.
      const vendorPayment = plan.gross_cost;
      if (vendorPayment > 0) {
        await chain.transfer({
          from: this.id,
          to: 'vendor.near',
          amount: vendorPayment,
          memo: `vendor ${purchase_id}`,
        });
      }
      p.plan = plan;
      p.status = 'settled';
      this.log('purchase_settled', {
        purchase_id,
        units: plan.units,
        unit_price: plan.unit_price,
        subsidy: plan.subsidy,
        vendor: vendorPayment,
        total_utility: plan.total_utility,
      });
      return { ok: true, purchase_id, plan };
    },

    // ---------------------------------------------------- private aggregation

    open_private_round: async ({ args }) => {
      const { round_id, min_agents } = args;
      if (this.privateRounds.has(round_id)) return { ok: false, error: 'round exists' };
      this.privateRounds.set(round_id, { round_id, min_agents, columns: new Map(), aggregate: null });
      this.log('private_round_opened', { round_id, min_agents });
      return { ok: true, round_id };
    },

    submit_private_column: async ({ args, signer }) => {
      const { round_id, column_sum } = args;
      const r = this.privateRounds.get(round_id);
      if (!r) return { ok: false, error: 'no such private round' };
      if (r.columns.has(signer)) return { ok: false, error: 'already submitted' };
      r.columns.set(signer, column_sum);
      this.log('private_column_submitted', { round_id, agent_id: signer });
      return { ok: true, round_id, submitted: r.columns.size };
    },

    finalize_private_round: async ({ args }) => {
      const { round_id } = args;
      const r = this.privateRounds.get(round_id);
      if (!r) return { ok: false, error: 'no such private round' };
      if (r.columns.size < r.min_agents) {
        return { ok: false, error: 'not enough columns', have: r.columns.size };
      }
      const total = [...r.columns.values()].reduce((a, b) => mod(a + b), 0n);
      r.aggregate = total;
      this.log('private_round_finalized', { round_id, aggregate: total.toString() });
      return { ok: true, round_id, aggregate: total.toString() };
    },
  };

  // ----------------------------------------------------------------- views

  views = {
    get_job: ({ args }) => {
      const job = this.jobs.get(args.job_id);
      if (!job) return null;
      return { ...job, bids: [...this.bids.get(args.job_id).values()] };
    },

    get_bids: ({ args }) => [...this.bids.get(args.job_id).values()],

    get_escrow: ({ args }) => {
      const e = this.escrows.get(args.escrow_id);
      if (!e) return null;
      if (e.shielded && !e.revealed) {
        // shielded: the amount stays private until the reveal
        return {
          escrow_id: e.escrow_id,
          job_id: e.job_id,
          status: e.status,
          shielded: true,
          commitment: e.commitment,
          amount: null,
        };
      }
      return { ...e };
    },

    get_escrows: () => [...this.escrows.values()].map((e) => ({
      escrow_id: e.escrow_id,
      job_id: e.job_id,
      status: e.status,
      shielded: e.shielded,
      commitment: e.commitment,
      amount: e.revealed === true || !e.shielded ? e.amount : null,
    })),

    get_agent: ({ args }) => {
      const a = this.agents.get(args.agent_id);
      if (!a) return null;
      return { agent_id: a.agent_id, score: a.passport.score };
    },

    get_passport: ({ args }) => {
      const a = this.agents.get(args.agent_id);
      if (!a) return null;
      const doc = a.passport.toJSON();
      doc.signature = a.passport.sign( this.issuer );
      return doc;
    },

    get_agents: () => [...this.agents.values()].map((a) => ({
      agent_id: a.agent_id,
      score: a.passport.score,
      balance: null,
    })),

    /**
     * Free social money held by the market. Escrow still owed to winners is
     * subtracted, so this is money that is genuinely available to the swarm.
     */
    get_treasury: async ({ args, chain }) => {
      const balance = await chain.getBalance(this.id);
      let owed = 0;
      for (const escrow of this.escrows.values()) {
        if (escrow.status === 'funded') owed += escrow.amount ?? 0;
      }
      return { balance, escrow_liability: owed, free_social_money: balance - owed };
    },

    get_purchase: ({ args }) => {
      const p = this.purchases.get(args.purchase_id);
      if (!p) return null;
      return {
        purchase_id: p.purchase_id,
        status: p.status,
        unit_base: p.unit_base,
        tiers: p.tiers,
        bids: [...p.bids.values()],
        plan: p.plan,
      };
    },

    get_private_round: ({ args }) => {
      const r = this.privateRounds.get(args.round_id);
      if (!r) return null;
      return {
        round_id: r.round_id,
        min_agents: r.min_agents,
        submitted: r.columns.size,
        aggregate: r.aggregate === null ? null : r.aggregate.toString(),
      };
    },

    get_events: () => this.events,
  };
}
