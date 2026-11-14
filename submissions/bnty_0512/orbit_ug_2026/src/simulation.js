// Deterministic multi-round swarm simulation.
//
// Rounds are scripted, but everything that *happens* inside a round is decided by
// the agents themselves from chain state: who bids, what they bid, who ratifies,
// who buys, what they contribute privately. The script only sets the stage.
//
// The whole run is reproducible: same seed -> same transcript, byte for byte.
import { LocalChain } from './chain.js';
import { SwarmMarketContract, HOUSE_ACCOUNT, CONTRACT_ID } from './market-contract.js';
import { ShieldPoolContract, POOL_CONTRACT_ID, FUNDING_CHUNK } from './shield-pool.js';
import { SwarmAgent } from './agents.js';
import { computeBidDigest, selectWinner } from './rules.js';
import { columnSum, shieldedCommitment, splitSecret, toField } from './privacy.js';
import { rngFrom, sha256 } from './util.js';

export const DEFAULT_SEED = 'near-swarm-2026';

const uNEAR = (n) => n;

export const AGENT_SPECS = [
  {
    id: 'atlas.near',
    skills: { research: 0.92, analysis: 0.78, writing: 0.7 },
    capital: 6_000_000,
    qualityBar: 0,
    rateCard: { research: 1_400_000, analysis: 1_600_000, writing: 1_200_000 },
    wanted: { research: 2, analysis: 1, writing: 1 },
  },
  {
    id: 'borealis.near',
    skills: { code: 0.9, ops: 0.72 },
    capital: 5_000_000,
    qualityBar: 0.55,
    rateCard: { code: 1_500_000, ops: 1_300_000 },
    wanted: { code: 2, ops: 1 },
  },
  {
    id: 'cinder.near',
    skills: { writing: 0.55, research: 0.4, translation: 0.52 },
    capital: 4_000_000,
    qualityBar: 0,
    rateCard: { writing: 900_000, research: 1_100_000 },
    wanted: { writing: 2, research: 1 },
  },
  {
    id: 'drift.near',
    skills: { analysis: 0.85, research: 0.6 },
    capital: 3_500_000,
    qualityBar: 0.6,
    rateCard: { analysis: 1_700_000, research: 1_500_000 },
    wanted: { analysis: 2, research: 1 },
  },
  {
    id: 'ember.near',
    skills: { code: 0.5, writing: 0.45, ops: 0.5 },
    capital: 2_500_000,
    qualityBar: 0,
    rateCard: { code: 1_000_000, writing: 800_000, ops: 900_000 },
    wanted: { code: 1, writing: 1, ops: 1 },
  },
];

const JOB_SCRIPT = [
  {
    job_id: 'job-alpha-1',
    skill: 'research',
    budget: 3_000_000,
    base_price: 3_000_000,
    min_reputation: 0,
    label: 'Market survey on on-chain agent hiring',
  },
  {
    job_id: 'job-bravo-2',
    skill: 'analysis',
    budget: 2_600_000,
    base_price: 2_600_000,
    min_reputation: 0,
    label: 'Reputation-weighted settlement audit',
  },
  {
    job_id: 'job-charlie-3',
    skill: 'writing',
    budget: 1_200_000,
    base_price: 1_200_000,
    min_reputation: 52,
    label: 'Summarise swarm governance notes',
  },
  {
    job_id: 'job-delta-4',
    skill: 'code',
    budget: 2_400_000,
    base_price: 2_400_000,
    min_reputation: 0,
    label: 'Reference escrow contract',
    shielded: true,
    secret_retainer: 1_900_000,
  },
  {
    job_id: 'job-echo-5',
    skill: 'translation',
    budget: 900_000,
    base_price: 900_000,
    min_reputation: 0,
    label: 'Translate validator handbook',
    note: 'nobody in the swarm has this skill -- the strict validators will not ratify it',
  },
  {
    job_id: 'job-foxtrot-6',
    skill: 'ops',
    budget: 2_000_000,
    base_price: 2_000_000,
    min_reputation: 0,
    label: 'Rotate validator set (re-posted after job-echo-5 failed to reach consensus)',
    revision_of: 'job-echo-5',
  },
];

export class SwarmSimulation {
  constructor({ seed = DEFAULT_SEED, contractId = CONTRACT_ID } = {}) {
    this.seed = seed;
    this.chain = new LocalChain({ seed });
    this.contract = new SwarmMarketContract({ id: contractId });
    this.chain.deployContract(this.contract);
    this.pool = new ShieldPoolContract();
    this.chain.deployContract(this.pool);
    this.chain.createAccount(HOUSE_ACCOUNT, 100_000_000);
    this.chain.createAccount('vendor.near', 0);
    // The privacy pool is pre-funded in one lump. That way no transfer ever
    // reveals the size of an individual shielded escrow.
    this.poolFunding = 12_000_000;
    this.agents = AGENT_SPECS.map(
      (spec) =>
        new SwarmAgent({
          id: spec.id,
          seed,
          skills: spec.skills,
          capital: spec.capital,
          qualityBar: spec.qualityBar,
        }),
    );
    this.agentById = new Map(this.agents.map((a) => [a.id, a]));
    // Agents need on-chain accounts so they can receive payouts and pay for
    // collective purchases.
    for (const agent of this.agents) {
      this.chain.createAccount(agent.id, agent.capital);
    }
    this.trace = [];
    this.round = 0;
  }

  // ------------------------------------------------------------- helpers

  log(type, payload) {
    this.trace.push({ round: this.round, type, ...payload });
  }

  async view(method, args) {
    return this.chain.viewCall({ contractId: this.contract.id, method, args });
  }

  async call(method, args, signer) {
    const { result } = await this.chain.callFunction({
      contractId: this.contract.id,
      method,
      args,
      signer,
    });
    return result;
  }

  async balances() {
    const out = {};
    for (const agent of this.agents) out[agent.id] = await this.chain.getBalance(agent.id);
    out['treasury (social money)'] = await this.chain.getBalance(this.contract.id);
    out[HOUSE_ACCOUNT] = await this.chain.getBalance(HOUSE_ACCOUNT);
    return out;
  }

  async scores() {
    const out = {};
    for (const agent of this.agents) {
      const p = await this.view('get_agent', { agent_id: agent.id });
      out[agent.id] = p ? p.score : null;
    }
    return out;
  }

  // -------------------------------------------------------------- phases

  async registerAgents() {
    // Pre-fund the privacy pool in a single lump transfer.
    await this.chain.transfer({
      from: HOUSE_ACCOUNT,
      to: POOL_CONTRACT_ID,
      amount: this.poolFunding,
      memo: 'prefund privacy pool',
    });
    this.log('privacy_pool_prefunded', {
      contract: POOL_CONTRACT_ID,
      amount: this.poolFunding,
      note: 'lump sum: no per-escrow transfer size is ever published',
    });
    for (const agent of this.agents) {
      await this.call(
        'register_agent',
        { agent_id: agent.id, public_key_hex: agent.publicKeyHex },
        agent.id,
      );
    }
    this.log('agents_registered', { agents: this.agents.map((a) => a.id) });
  }

  /** One job lifecycle: post -> bid -> ratify -> finalize -> settle. */
  async runJob(spec) {
    this.round += 1;
    const job = {
      job_id: spec.job_id,
      skill: spec.skill,
      budget: spec.budget,
      base_price: spec.base_price,
      min_reputation: spec.min_reputation,
      shielded: !!spec.shielded,
      commitment: null,
    };
    if (spec.shielded) {
      // The escrowed retainer is committed to, never published in the clear. It
      // is deliberately NOT the published budget: the budget is only a cap, so
      // the public ledger reveals nothing about the real amount.
      const rand = rngFrom(`${this.seed}|${spec.job_id}|shield`);
      const blinding = String(Math.floor(rand() * 1e9));
      const nonce = String(Math.floor(rand() * 1e9));
      const amount = spec.secret_retainer;
      job.commitment = shieldedCommitment({ amount, nonce, blinding });
      job._shield = { amount, nonce, blinding };
    }
    await this.call('post_job', job, HOUSE_ACCOUNT);
    this.log('job_posted', {
      job_id: spec.job_id,
      label: spec.label,
      skill: spec.skill,
      budget: spec.budget,
      min_reputation: spec.min_reputation,
      shielded: !!spec.shielded,
    });

    // --- bidding -------------------------------------------------------
    const bids = [];
    for (const agent of this.agents) {
      const score = (await this.view('get_agent', { agent_id: agent.id })).score;
      const plan = agent.planBid(job, score);
      if (!plan) {
        this.log('bid_skipped', { job_id: spec.job_id, agent_id: agent.id, reason: 'not attractive' });
        continue;
      }
      const res = await this.call('bid', { job_id: spec.job_id, ...plan }, agent.id);
      if (res.ok) {
        bids.push({ agent_id: agent.id, ...plan, score });
        this.log('bid_placed', {
          job_id: spec.job_id,
          agent_id: agent.id,
          price: plan.price,
          quality: plan.quality,
          score,
        });
      } else {
        this.log('bid_rejected', { job_id: spec.job_id, agent_id: agent.id, error: res.error, score });
      }
    }

    // --- leaderless ratification --------------------------------------
    const onChainBids = await this.view('get_bids', { job_id: spec.job_id });
    const onChainJob = await this.view('get_job', { job_id: spec.job_id });
    const expectedDigest = computeBidDigest(onChainJob, onChainBids);
    let votes = 0;
    for (const agent of this.agents) {
      const { vote, reason } = agent.ratify(onChainJob, onChainBids);
      if (!vote) {
        this.log('vote_withheld', {
          job_id: spec.job_id,
          agent_id: agent.id,
          reason,
        });
        continue;
      }
      const res = await this.call(
        'submit_vote',
        { job_id: spec.job_id, digest: vote.digest, signature: vote.signature },
        agent.id,
      );
      if (res.ok) {
        votes += 1;
        this.log('vote_cast', { job_id: spec.job_id, agent_id: agent.id, quorum: res.quorum });
      } else {
        this.log('vote_rejected', { job_id: spec.job_id, agent_id: agent.id, error: res.error });
      }
    }

    // --- finalize ------------------------------------------------------
    const finalize = await this.call('finalize_bidding', { job_id: spec.job_id }, HOUSE_ACCOUNT);
    if (!finalize.ok) {
      this.log('consensus_failed', {
        job_id: spec.job_id,
        votes_for: finalize.votes_for,
        quorum: finalize.quorum,
        note: 'no supermajority: the job is NOT awarded (the demo re-posts it with revised terms in a later round)',
      });
      return { awarded: false, job_id: spec.job_id };
    }
    this.log('job_awarded', {
      job_id: spec.job_id,
      winner: finalize.winner,
      price: finalize.price,
      quality: finalize.quality,
      votes_for: finalize.votes_for,
      quorum: finalize.quorum,
      digest: expectedDigest.slice(0, 16),
    });

    // --- delivery + settlement ----------------------------------------
    const delivered = this.deliveryQuality(finalize, spec.skill);
    const reveal = spec.shielded
      ? {
          amount: job._shield.amount,
          nonce: job._shield.nonce,
          blinding: job._shield.blinding,
        }
      : null;
    const settle = await this.call(
      'settle_job',
      { job_id: spec.job_id, delivered_quality: delivered, reveal },
      HOUSE_ACCOUNT,
    );
    this.log('job_settled', {
      job_id: spec.job_id,
      winner: settle.winner,
      price: settle.price,
      fee_to_social_money: settle.fee,
      delivered_quality: delivered,
      reputation_score: settle.score,
      revealed_amount: spec.shielded ? spec.secret_retainer : null,
    });
    return { awarded: true, job_id: spec.job_id, winner: finalize.winner };
  }

  /** Deterministic delivery quality: skill-based with a small seeded noise. */
  deliveryQuality(award, skill) {
    const agent = this.agentById.get(award.winner);
    const rand = rngFrom(`${this.seed}|${award.job_id}|deliver`);
    const base = agent.skillScore(skill);
    const noise = (rand() - 0.5) * 0.3;
    return Number(Math.max(0, Math.min(1, base * 0.75 + award.quality * 0.25 + noise)).toFixed(4));
  }

  /** Collective purchase: agents bid for units, the swarm pool subsidises. */
  async runPurchase(spec) {
    this.round += 1;
    await this.call(
      'open_purchase',
      {
        purchase_id: spec.purchase_id,
        unit_base: spec.unit_base,
        units_target: spec.units_target,
        tiers: spec.tiers,
      },
      HOUSE_ACCOUNT,
    );
    this.log('purchase_opened', {
      purchase_id: spec.purchase_id,
      unit_base: spec.unit_base,
      units_target: spec.units_target,
      tiers: spec.tiers,
    });

    for (const agent of this.agents) {
      const balance = await this.chain.getBalance(agent.id);
      const plan = agent.planPurchase({
        purchase: { purchase_id: spec.purchase_id, unit_base: spec.unit_base },
        balance,
        wantedUnits: spec.wanted[agent.id] ?? 1,
      });
      if (!plan) {
        this.log('purchase_bid_skipped', { purchase_id: spec.purchase_id, agent_id: agent.id });
        continue;
      }
      await this.call('bid_purchase', { purchase_id: spec.purchase_id, ...plan }, agent.id);
      this.log('purchase_bid', {
        purchase_id: spec.purchase_id,
        agent_id: agent.id,
        units: plan.units,
        valuation_per_unit: plan.valuation_per_unit,
        max_spend: plan.max_spend,
      });
    }

    const res = await this.call('settle_purchase', { purchase_id: spec.purchase_id }, HOUSE_ACCOUNT);
    if (!res.ok) {
      this.log('purchase_failed', { purchase_id: spec.purchase_id, error: res.error });
      return;
    }
    const plan = res.plan;
    this.log('purchase_settled', {
      purchase_id: spec.purchase_id,
      units: plan.units,
      unit_price: plan.unit_price,
      gross_cost: plan.gross_cost,
      social_money_subsidy: plan.subsidy,
      total_utility: plan.total_utility,
      fairness_gini: plan.fairness_gini,
      allocation: plan.allocation,
    });
  }

  /**
   * Private job: shielded payment + private aggregation.
   * Agents split a private value into shares (additive secret sharing); only the
   * per-agent column sums reach the chain, and the chain only publishes the total.
   */
  async runPrivateRound(spec) {
    this.round += 1;
    const n = this.agents.length;
    // --- private aggregation ------------------------------------------
    await this.call(
      'open_private_round',
      { round_id: spec.round_id, min_agents: n },
      HOUSE_ACCOUNT,
    );
    const sharesByAgent = new Map();
    const privateValues = new Map();
    for (const agent of this.agents) {
      const value = agent.privateValue(spec.round_id, 'load');
      privateValues.set(agent.id, value);
      const shares = splitSecret(value, n, agent.rng(`share|${spec.round_id}`));
      sharesByAgent.set(agent.id, shares);
    }
    // Agent j receives share j from every other agent (peer to peer, off-chain).
    for (const agent of this.agents) {
      const column = [];
      for (const other of this.agents) {
        column.push(sharesByAgent.get(other.id)[this.agents.indexOf(agent)]);
      }
      const sum = columnSum(column);
      await this.call('submit_private_column', { round_id: spec.round_id, column_sum: sum }, agent.id);
      this.log('private_column_submitted', {
        round_id: spec.round_id,
        agent_id: agent.id,
        column_sum: sum.toString(),
      });
    }
    const fin = await this.call('finalize_private_round', { round_id: spec.round_id }, HOUSE_ACCOUNT);
    const trueTotal = [...privateValues.values()].reduce((a, b) => toField(a + b), 0n);
    this.log('private_aggregate_published', {
      round_id: spec.round_id,
      aggregate: fin.aggregate,
      matches_sum_of_private_values: fin.aggregate === trueTotal.toString(),
      individual_values_published: 0,
    });

    // --- shielded payment ---------------------------------------------
    await this.call(
      'post_job',
      {
        job_id: spec.job_id,
        skill: spec.skill,
        budget: spec.budget,
        base_price: spec.base_price,
        min_reputation: 0,
        shielded: true,
        commitment: shieldedCommitment({
          amount: spec.secret_retainer,
          nonce: spec.nonce,
          blinding: spec.blinding,
        }),
      },
      HOUSE_ACCOUNT,
    );
    this.log('private_job_posted', {
      job_id: spec.job_id,
      budget: spec.budget,
      note: 'escrow amount is committed to, not published',
    });

    for (const agent of this.agents) {
      const score = (await this.view('get_agent', { agent_id: agent.id })).score;
      const plan = agent.planBid(
        { job_id: spec.job_id, skill: spec.skill, budget: spec.budget, base_price: spec.base_price },
        score,
      );
      if (!plan) continue;
      const res = await this.call('bid', { job_id: spec.job_id, ...plan }, agent.id);
      if (res.ok) {
        this.log('bid_placed', {
          job_id: spec.job_id,
          agent_id: agent.id,
          price: plan.price,
          quality: plan.quality,
          score,
        });
      }
    }

    const onChainBids = await this.view('get_bids', { job_id: spec.job_id });
    const onChainJob = await this.view('get_job', { job_id: spec.job_id });
    for (const agent of this.agents) {
      const { vote, reason } = agent.ratify(onChainJob, onChainBids);
      if (!vote) {
        this.log('vote_withheld', { job_id: spec.job_id, agent_id: agent.id, reason });
        continue;
      }
      await this.call(
        'submit_vote',
        { job_id: spec.job_id, digest: vote.digest, signature: vote.signature },
        agent.id,
      );
    }
    const finalize = await this.call('finalize_bidding', { job_id: spec.job_id }, HOUSE_ACCOUNT);
    if (!finalize.ok) {
      this.log('consensus_failed', {
        job_id: spec.job_id,
        votes_for: finalize.votes_for,
        quorum: finalize.quorum,
      });
      return;
    }
    this.log('job_awarded', {
      job_id: spec.job_id,
      winner: finalize.winner,
      price: finalize.price,
      quality: finalize.quality,
      votes_for: finalize.votes_for,
      quorum: finalize.quorum,
    });

    const escrowBefore = await this.view('get_escrow', { escrow_id: `escrow:${spec.job_id}` });
    this.log('shielded_escrow_state', {
      job_id: spec.job_id,
      public_amount: escrowBefore.amount,
      commitment: escrowBefore.commitment.slice(0, 16),
      note: 'amount hidden until the completion reveal',
    });

    const delivered = this.deliveryQuality({ ...finalize, job_id: spec.job_id }, spec.skill);
    const settle = await this.call(
      'settle_job',
      {
        job_id: spec.job_id,
        delivered_quality: delivered,
        reveal: { amount: spec.secret_retainer, nonce: spec.nonce, blinding: spec.blinding },
      },
      HOUSE_ACCOUNT,
    );
    this.log('job_settled', {
      job_id: spec.job_id,
      winner: settle.winner,
      price: settle.price,
      fee_to_social_money: settle.fee,
      delivered_quality: delivered,
      revealed_amount: spec.secret_retainer,
      reputation_score: settle.score,
    });
  }

  /** Run the whole scripted scenario. */
  async run() {
    await this.registerAgents();
    for (const spec of JOB_SCRIPT) {
      await this.runJob(spec);
    }
    await this.runPurchase({
      purchase_id: 'purchase-compute-1',
      unit_base: 900_000,
      units_target: 8,
      tiers: [
        { minUnits: 3, discount_bps: 1000 },
        { minUnits: 6, discount_bps: 2200 },
      ],
      wanted: {
        'atlas.near': 2,
        'borealis.near': 2,
        'cinder.near': 1,
        'drift.near': 2,
        'ember.near': 1,
      },
    });
    await this.runPrivateRound({
      round_id: 'private-round-1',
      job_id: 'job-golf-7',
      skill: 'analysis',
      budget: 2_200_000,
      base_price: 2_200_000,
      nonce: '884422',
      blinding: '55100399',
      secret_retainer: 1_750_000,
    });

    const finalBalances = await this.balances();
    const finalScores = await this.scores();
    this.log('simulation_finished', { final_balances: finalBalances, final_scores: finalScores });

    return {
      seed: this.seed,
      rounds: this.round,
      trace: this.trace,
      final_balances: finalBalances,
      final_scores: finalScores,
      chain_receipts: this.chain.receipts.length,
    };
  }
}

export async function runSimulation(opts = {}) {
  const sim = new SwarmSimulation(opts);
  return sim.run();
}
