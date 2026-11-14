import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeterministicStateMachine, TRACK_CODE, BOUNTY_ID, MECHANISM } from '../src/engine.mjs';
import { STEPS } from '../src/fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const machine = new DeterministicStateMachine();
const snap = machine.runAllTryItSteps(STEPS);

const lines = [
  `=== ${TRACK_CODE} (${BOUNTY_ID}) DETERMINISTIC DEMO TRANSCRIPT ===`,
  `Mechanism: ${MECHANISM}`,
  `Chain Integrity Verified: ${snap.chainVerified}`,
  `State Invariants Violations: ${snap.invariantViolations.length}`,
  `Final State Hash-Chain Head:  ${snap.headHash}`,
  ''
];

for (const ev of snap.events) {
  lines.push(`[STEP ${ev.index + 1}] ${ev.step}`);
  lines.push(`  Summary: ${ev.summary}`);
  lines.push(`  Metrics: ${JSON.stringify(ev.metrics)}`);
  lines.push(`  Hash:    ${ev.hash}`);
  lines.push('');
}

lines.push('=== DERIVED FINAL STATE ===');
lines.push(`  vault balance:        ${snap.state.vault_balance_usdc} USDC`);
for (const b of snap.state.budgets) {
  lines.push(
    `  budget ${b.budget_id}: total ${b.total_usdc} USDC, spent ${b.spent_usdc} USDC, ` +
      `remaining ${b.remaining_usdc} USDC, gate reputation >= ${b.min_reputation}`
  );
}
for (const [actor, rep] of Object.entries(snap.state.reputation)) {
  lines.push(`  reputation ${actor}: ${rep}`);
}
for (const [actor, bal] of Object.entries(snap.state.reward_balance)) {
  lines.push(`  reward balance ${actor}: ${bal} USDC`);
}
lines.push('');

const transcript = lines.join('\n');
fs.writeFileSync(path.join(rootDir, 'docs', 'demo-transcript.txt'), transcript, 'utf8');
fs.writeFileSync(path.join(rootDir, 'docs', 'demo-trace.json'), JSON.stringify(snap, null, 2) + '\n', 'utf8');
process.stdout.write(transcript);
