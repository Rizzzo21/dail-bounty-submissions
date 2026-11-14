// Escrows: money that only moves when a reputation gate says it may.
//
// The escrow names the CATEGORIES the beneficiary must clear. Release is a
// conjunction over those categories - the composite score is never consulted,
// so an agent cannot buy its way past a weak category with a strong one.
import { hash } from './util.js';
import { categoryScores, compositeScore, evaluateGates } from './score.js';

function record(escrow, entry) {
  escrow.history.push(entry);
  return entry;
}

export function openEscrow(state, { creator, beneficiary, amount, categories, note, timestamp }) {
  if (!state.agents[creator]) throw new Error('the creator is not a registered agent');
  if (!state.agents[beneficiary]) throw new Error('the beneficiary is not a registered agent');
  if (!(amount > 0)) throw new Error('the escrow amount must be positive');
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error('an escrow must name at least one category to gate on');
  }
  for (const category of categories) {
    if (!state.policy.categories[category]) throw new Error(`unknown category "${category}"`);
  }
  const id = `esc_${hash({ creator, beneficiary, amount, categories, timestamp }).slice(0, 24)}`;
  const escrow = {
    id,
    creator,
    beneficiary,
    amount,
    funded: 0,
    categories,
    note: note || null,
    status: 'OPEN',
    createdAt: timestamp,
    fundedAt: null,
    closedAt: null,
    releasedTo: null,
    history: [],
  };
  state.escrows[id] = escrow;
  state.escrowOrder.push(id);
  state.agents[creator].escrows.push(id);
  state.agents[beneficiary].escrows.push(id);
  record(escrow, { at: timestamp, type: 'opened', detail: `gated on ${categories.join(', ')}` });
  return escrow;
}

export function fundEscrow(state, { escrowId, payer, amount, timestamp }) {
  const escrow = state.escrows[escrowId];
  if (!escrow) throw new Error('unknown escrow');
  if (escrow.status !== 'OPEN') throw new Error(`the escrow is ${escrow.status}, not OPEN`);
  if (!(amount > 0)) throw new Error('the funding amount must be positive');
  if (amount > state.agents[payer].credits) {
    throw new Error(`${state.agents[payer].name} holds ${state.agents[payer].credits} credits, needs ${amount}`);
  }
  state.agents[payer].credits -= amount;
  escrow.funded += amount;
  escrow.status = 'FUNDED';
  escrow.fundedAt = timestamp;
  record(escrow, { at: timestamp, type: 'funded', detail: `${amount} credits from ${state.agents[payer].name}` });
  return escrow;
}

// The gate check. A refusal names the categories that failed - and says nothing
// about the composite, because the composite is not part of the decision.
export function releaseEscrow(state, { escrowId, timestamp, approver }) {
  const escrow = state.escrows[escrowId];
  if (!escrow) throw new Error('unknown escrow');
  if (escrow.status !== 'FUNDED') throw new Error(`the escrow is ${escrow.status}, not FUNDED`);
  const beneficiary = state.agents[escrow.beneficiary];
  const attestations = beneficiary.attestations.map((id) => state.attestations[id]);
  const scores = categoryScores(attestations, state.policy, timestamp);
  const gates = evaluateGates(scores, state.policy);
  const required = escrow.categories.map((category) => {
    const gate = gates.gates.find((g) => g.category === category);
    return { category, minimum: gate.minimum, score: gate.score, pass: gate.pass };
  });
  const failed = required.filter((gate) => !gate.pass);
  if (failed.length > 0) {
    const detail = failed
      .map((gate) => `${gate.category} scores ${gate.score}, needs ${gate.minimum}`)
      .join('; ');
    record(escrow, { at: timestamp, type: 'release_refused', detail });
    const error = new Error(
      `the release is refused: ${detail}`,
    );
    error.gates = required;
    error.composite = compositeScore(scores, state.policy);
    throw error;
  }
  beneficiary.credits += escrow.funded;
  escrow.status = 'RELEASED';
  escrow.closedAt = timestamp;
  escrow.releasedTo = beneficiary.address;
  record(escrow, {
    at: timestamp,
    type: 'released',
    detail: `${escrow.funded} credits to ${beneficiary.name} (approved by ${state.agents[approver]?.name ?? 'the registry'})`,
  });
  return escrow;
}

export function refundEscrow(state, { escrowId, reason, timestamp }) {
  const escrow = state.escrows[escrowId];
  if (!escrow) throw new Error('unknown escrow');
  if (!['OPEN', 'FUNDED'].includes(escrow.status)) {
    throw new Error(`the escrow is ${escrow.status}, it cannot be refunded`);
  }
  const payer = escrow.payer ?? escrow.creator;
  state.agents[payer].credits += escrow.funded;
  escrow.status = 'REFUNDED';
  escrow.closedAt = timestamp;
  record(escrow, { at: timestamp, type: 'refunded', detail: reason || 'no reason given' });
  return escrow;
}

export function escrowHistory(state, agentAddress) {
  const agent = state.agents[agentAddress];
  if (!agent) throw new Error('unknown agent');
  return agent.escrows.map((id) => {
    const escrow = state.escrows[id];
    return {
      id: escrow.id,
      status: escrow.status,
      amount: escrow.amount,
      funded: escrow.funded,
      categories: escrow.categories,
      counterparty: escrow.creator === agentAddress ? escrow.beneficiary : escrow.creator,
      history: escrow.history,
    };
  });
}
