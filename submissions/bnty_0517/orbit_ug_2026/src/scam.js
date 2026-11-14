// The scam screen.
//
// It runs on the INSTRUCTION that came with a request, before the policy
// engine sees the money. The signals are deterministic rules over the text and
// the shape of the request - no model, no network, no randomness - and every
// hit is reported with its reason, so a hold is explainable.
//
// The addresses in SEEDED_SCAM_ADDRESSES are TEST FIXTURES: addresses this
// repository derives from a fixed seed. They are not real-world accusations.

export const HOLD_THRESHOLD = 4;
// At or above this score the instruction is refused outright: no approval can
// bring it back, because the patterns here are not judgement calls.
export const HARD_BLOCK_THRESHOLD = 8;

export const SCAM_SIGNALS = [
  {
    id: 'urgency',
    weight: 2,
    reason: 'the message pushes for urgency',
    test: (instruction) => /urgent|immediately|right away|before it (expires|closes|is frozen)/i.test(instruction.text || ''),
  },
  {
    id: 'overpayment',
    weight: 3,
    reason: 'it asks for a refund of an overpayment - the classic fake cheque',
    test: (instruction) => /refund|send back the difference|overpaid|overpayment/i.test(instruction.text || ''),
  },
  {
    id: 'no-log',
    weight: 3,
    reason: 'it asks the agent to keep the transaction off the record',
    test: (instruction) => /don'?t\s+log|do not log|without logging|no record|don'?t\s+tell|keep (this |it )?quiet/i.test(instruction.text || ''),
  },
  {
    id: 'known-bad',
    weight: 5,
    reason: 'the destination is on the seeded scam list',
    test: (instruction, { scamList }) => (scamList || []).includes(instruction.to),
  },
  {
    id: 'new-counterparty',
    weight: 2,
    reason: 'the counterparty has never been seen before',
    test: (instruction, { allowlist }) => !(allowlist || []).includes(instruction.to),
  },
  {
    id: 'over-limit',
    weight: 2,
    reason: 'the amount is above what this wallet may move in one transfer',
    test: (instruction, { limit }) => typeof limit === 'number' && (instruction.amount || 0) > limit,
  },
  {
    id: 'rule-change',
    weight: 4,
    reason: 'it asks the agent to change its own limits',
    test: (instruction) =>
      /raise (the |your )?limit|change (the |your )?(limit|policy|allowlist)|disable (the )?(check|logging|limit)|allowlist me|add me to/i.test(
        instruction.text || '',
      ),
  },
];

export function screenInstruction(instruction, { limit, allowlist = [], scamList = [] } = {}) {
  const signals = [];
  for (const signal of SCAM_SIGNALS) {
    let hit = false;
    try {
      hit = Boolean(signal.test(instruction, { limit, allowlist, scamList }));
    } catch {
      hit = false;
    }
    if (hit) signals.push({ id: signal.id, weight: signal.weight, reason: signal.reason });
  }
  const score = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const flagged = score >= HOLD_THRESHOLD;
  const hardBlock = score >= HARD_BLOCK_THRESHOLD;
  return {
    flagged,
    hardBlock,
    score,
    signals,
    threshold: HOLD_THRESHOLD,
    hardBlockThreshold: HARD_BLOCK_THRESHOLD,
    decision: hardBlock ? 'BLOCK' : flagged ? 'HOLD' : 'PASS',
  };
}
