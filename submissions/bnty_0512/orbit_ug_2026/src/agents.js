// Autonomous agents.
//
// An agent is not a mock: it owns an Ed25519 keypair, holds a balance, reads the
// market from chain state, and makes its own decisions from its own private
// policy (skill levels, risk appetite, quality bar, budget). Everything is driven
// by a seeded PRNG so a run is byte-for-byte reproducible.
import { keypairFromSeed, rngFrom, sha256, signWith } from './util.js';
import { computeBidDigest, selectWinner } from './rules.js';

export const SKILLS = ['research', 'code', 'analysis', 'writing', 'ops'];

export class SwarmAgent {
  constructor({
    id,
    seed = 'near-swarm-2026',
    skills = {},
    capital = 5_000_000,
    qualityBar = 0.0,
    spendCap = 0.6,
    bidStrategy = 'value',
    reservePriceFactor = 0.5,
  }) {
    this.id = id;
    this.seed = seed;
    this.skills = skills;
    this.capital = capital;
    this.qualityBar = qualityBar;
    this.spendCap = spendCap;
    this.bidStrategy = bidStrategy;
    this.reservePriceFactor = reservePriceFactor;
    this.keypair = keypairFromSeed(sha256(`${seed}|${id}|key`));
    this.publicKeyHex = this.keypair.publicKeyHex;
  }

  rng(label) {
    return rngFrom(`${this.seed}|${this.id}|${label}`);
  }

  /** Skill score in [0,1]; unknown skills are weak but not zero. */
  skillScore(skill) {
    return this.skills[skill] ?? 0.25;
  }

  /**
   * Decide whether and how to bid on a job.
   * Returns null when the agent does not want the job.
   */
  planBid(job, score) {
    const rand = this.rng(`bid|${job.job_id}`);
    const skill = this.skillScore(job.skill);
    // Agents with a strong skill and a good reputation bid more confidently.
    const confidence = Math.min(1, skill * 0.7 + (score / 100) * 0.3);
    // An agent only walks away when the job is clearly below its skill level;
    // otherwise it competes, and the outcome is decided by the auction.
    if (confidence < 0.35) return null;
    const quality = Math.min(1, skill * (0.8 + rand() * 0.25));
    if (quality < this.qualityBar) return null;
    // Price: between the agent's reserve price and the job budget.
    const reserve = Math.round(job.budget * this.reservePriceFactor);
    const aggressiveness = this.bidStrategy === 'aggressive' ? 0.35 : 0.7;
    const price = Math.max(1, Math.round(reserve + (job.budget - reserve) * (1 - aggressiveness) * rand()));
    const deliverDays = 1 + Math.floor(rand() * 5);
    return { price: Math.min(price, job.budget), quality: Number(quality.toFixed(4)), deliver_days: deliverDays };
  }

  /** Compute the digest this agent independently derives from chain state. */
  deriveDigest(job, bids) {
    return computeBidDigest(job, bids);
  }

  /**
   * Ratify a market outcome. The agent re-derives the digest itself and only
   * signs it when the implied winner clears its own quality bar. This is what
   * makes the consensus leaderless: nobody is told what to vote.
   */
  ratify(job, bids) {
    const digest = this.deriveDigest(job, bids);
    const winner = selectWinner(bids);
    if (!winner) return { vote: null, reason: 'no bids to ratify' };
    if (winner.quality < this.qualityBar) {
      return { vote: null, reason: `winner quality ${winner.quality} below my bar ${this.qualityBar}` };
    }
    const signature = signWith(this.keypair.priv, digest);
    return { vote: { digest, signature, agent_id: this.id }, reason: null };
  }

  /** Bid for units in a collective purchase. */
  planPurchase({ purchase, balance, wantedUnits }) {
    const rand = this.rng(`buy|${purchase.purchase_id}`);
    const want = Math.max(0, Math.min(wantedUnits, 2 + Math.floor(rand() * 3)));
    if (want === 0) return null;
    const valuationPerUnit = Math.round(purchase.unit_base * (1 + rand() * 0.35));
    const maxSpend = Math.min(Math.round(balance * this.spendCap), valuationPerUnit * want);
    return { units: want, valuation_per_unit: valuationPerUnit, max_spend: maxSpend };
  }

  /** Private value contributed to a private aggregation round. */
  privateValue(roundId, salt) {
    const rand = this.rng(`private|${roundId}|${salt}`);
    return BigInt(Math.floor(rand() * 1_000_000));
  }
}
