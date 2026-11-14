// Shared market rules.
//
// Both the contract and the autonomous agents import these, so an agent can
// independently re-derive the market outcome from raw chain data -- which is
// exactly what the leaderless ratification step needs.
import { digestOf } from './util.js';

const cmpIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Canonical digest over the job and its (sorted) bid set. */
export function computeBidDigest(job, bids) {
  const sorted = [...bids].sort((a, b) => cmpIds(a.agent_id, b.agent_id));
  return digestOf({
    job_id: job.job_id,
    skill: job.skill,
    budget: job.budget,
    min_reputation: job.min_reputation,
    min_quality: job.min_quality ?? null,
    bids: sorted.map((b) => ({
      agent_id: b.agent_id,
      price: b.price,
      quality: b.quality,
      deliver_days: b.deliver_days,
    })),
  });
}

/** Winner rule: best quality, then cheapest, then lowest agent id. */
export function selectWinner(bids) {
  if (!bids || bids.length === 0) return null;
  const sorted = [...bids].sort(
    (a, b) => b.quality - a.quality || a.price - b.price || cmpIds(a.agent_id, b.agent_id),
  );
  return sorted[0];
}

/** A bid is eligible when it clears the reputation gate and the quality floor. */
export function bidEligible(bid, job, scoreOf) {
  if (scoreOf(bid.agent_id) < job.min_reputation) return false;
  if (job.min_quality != null && bid.quality < job.min_quality) return false;
  return true;
}
