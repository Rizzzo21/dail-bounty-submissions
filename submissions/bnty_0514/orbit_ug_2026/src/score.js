// Scoring: a passport is a VECTOR of category scores, never a single number.
//
// The composite score exists (people want one number), but it is never an input
// to any gate. A gate is a conjunction over categories: every category has to
// clear its own minimum. That is what "refuses a single category" means - one
// excellent category cannot carry a missing one.
import { round } from './util.js';

const DAY = 86400;

export function decayFactor(issuedAt, asOf, halflifeDays) {
  const ageDays = Math.max(0, (asOf - issuedAt) / DAY);
  return 0.5 ** (ageDays / halflifeDays);
}

export function categoryScores(attestations, policy, asOf) {
  const scores = {};
  for (const [category, rule] of Object.entries(policy.categories)) {
    const relevant = attestations.filter((attestation) => attestation.category === category);
    let weighted = 0;
    let weightTotal = 0;
    const detail = [];
    for (const attestation of relevant) {
      const decay = decayFactor(attestation.issuedAt, asOf, policy.halflifeDays);
      const contribution = attestation.value * attestation.weight * decay;
      weighted += contribution;
      // The denominator is the FULL weight of the claims on file, not the
      // decayed weight: a claim that has aged contributes less, so the score
      // falls with time instead of being normalised away.
      weightTotal += attestation.weight;
      detail.push({
        id: attestation.id,
        claim: attestation.claim,
        value: attestation.value,
        weight: attestation.weight,
        decay: round(decay, 6),
        contribution: round(contribution, 6),
        issuedAt: attestation.issuedAt,
      });
    }
    scores[category] = {
      category,
      label: rule.label,
      score: weightTotal > 0 ? round((weighted / weightTotal) * 100, 4) : 0,
      count: relevant.length,
      weight: rule.weight,
      minimum: rule.minimum,
      detail,
    };
  }
  return scores;
}

export function compositeScore(scores, policy) {
  let weighted = 0;
  let weightTotal = 0;
  for (const [category, entry] of Object.entries(scores)) {
    const rule = policy.categories[category];
    if (!rule) continue;
    weighted += entry.score * rule.weight;
    weightTotal += rule.weight;
  }
  return weightTotal > 0 ? round(weighted / weightTotal, 4) : 0;
}

// THE RULE. Note what is not in here: the composite score.
export function evaluateGates(scores, policy) {
  const gates = Object.entries(policy.categories).map(([category, rule]) => {
    const score = scores[category]?.score ?? 0;
    return { category, minimum: rule.minimum, score, pass: score >= rule.minimum };
  });
  const failed = gates.filter((gate) => !gate.pass).map((gate) => gate.category);
  return { pass: failed.length === 0, gates, failed };
}
