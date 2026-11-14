// The demo: the three try-it steps a stranger can follow.
//
//   node scripts/demo.mjs          the transcript
//   node scripts/demo.mjs --json   the same run as JSON
//
// No network, no clock: every timestamp is a constant below.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAttestations } from '../src/attestations.js';
import {
  emit,
  fundEscrow,
  importAttestation,
  issueCard,
  openEscrow,
  passportOf,
  releaseEscrow,
  resolveAgent,
  verifyCard,
} from '../src/engine.js';
import { escrowHistory } from '../src/escrow.js';
import { createParties, createState } from '../src/state.js';
import { canonical, fmtNum, hash, round } from '../src/util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');

const T0 = 1800000000;
const DAY = 86400;
// The passport is read 97 days after the attestations were compiled, so every
// claim has decayed by a factor of 0.5^(7/90).
const ASOF = T0 + 97 * DAY;
const COMPILED_AT = T0 + 90 * DAY;

const lines = [];
const say = (line = '') => {
  lines.push(line);
  if (!asJson) console.log(line);
};

const parties = createParties();
const state = createState({ parties });
const agents = {};
for (const holder of parties.values()) agents[holder.name] = holder;

const nameOf = (address) => state.agents[address]?.name ?? address;
const pretty = (message) =>
  Object.keys(state.agents).reduce(
    (text, address) => text.split(address).join(state.agents[address].name),
    message,
  );

// ---------------------------------------------------------------- 0. evidence
const { attestations, refusals } = buildAttestations(path.join(root, 'attestations'), {
  agents,
  asOf: ASOF,
  issuedAt: COMPILED_AT,
});
say('STEP 0 - THE PASSPORT CHECKS ITS EVIDENCE');
say('  it reads two published artifacts and re-hashes every record in them');
const anchorLines = fs.readFileSync(path.join(root, 'attestations/anchor-events.jsonl'), 'utf8').split('\n').filter(Boolean);
const ritualRecords = JSON.parse(fs.readFileSync(path.join(root, 'attestations/ritual-scenarios.json'), 'utf8')).scenarios;
say(`  anchor-events.jsonl      ${anchorLines.length} records  (bnty_0414 ANCHOR, published)`);
say(`  ritual-scenarios.json    ${ritualRecords.length} records  (bnty_0421 RITUAL, published)`);
for (const attestation of attestations) importAttestation(state, attestation);
say(`  ${attestations.length} claims traced to those records, ${refusals.length} refused`);
say('');

// ---------------------------------------------------------------- 1. lookup
say('STEP 1 - PASSPORT LOOKUP');
say('  GET the passport of agent-ava');
const ava = passportOf(state, 'agent-ava', ASOF);
for (const [category, entry] of Object.entries(ava.scores)) {
  const verdict = entry.score >= entry.minimum ? 'pass' : 'FAIL';
  say(
    `    ${category.padEnd(11)} ${String(entry.score.toFixed(2)).padStart(6)}  needs ${String(entry.minimum).padStart(3)}  ${verdict}   (${entry.count} attestation${entry.count === 1 ? '' : 's'})`,
  );
}
say(`    composite   ${ava.composite.toFixed(2)}  <- a number for humans, not a gate`);
say(`    gates       ${ava.gates.pass ? 'all clear' : `REFUSED (${ava.gates.failed.join(', ')})`}`);
say('');

// ---------------------------------------------------------------- 2. escrow
say('STEP 2 - ESCROW HISTORY');
const echo = resolveAgent(state, 'client-echo').address;
const bob = resolveAgent(state, 'agent-bob').address;

const good = openEscrow(state, {
  creator: echo,
  beneficiary: bob,
  amount: 300,
  categories: ['settlement', 'community'],
  note: 'work delivered by agent-bob',
  timestamp: ASOF,
});
fundEscrow(state, { escrowId: good.id, payer: echo, amount: 300, timestamp: ASOF + 60 });
emit(state, 'escrow_opened', { id: good.id, beneficiary: bob, amount: 300, categories: good.categories });
emit(state, 'escrow_funded', { id: good.id, amount: 300 });
releaseEscrow(state, { escrowId: good.id, timestamp: ASOF + 120, approver: state.registry });
emit(state, 'escrow_released', { id: good.id, to: bob, amount: 300 });
say(`  client-echo opens an escrow for agent-bob, gated on settlement + community`);
say(`  funded ${fmtNum(300)} credits`);
say(`  released -> ${fmtNum(state.agents[bob].credits)} credits now sit with agent-bob`);

const blocked = openEscrow(state, {
  creator: echo,
  beneficiary: resolveAgent(state, 'agent-ava').address,
  amount: 500,
  categories: ['settlement', 'community'],
  note: 'work delivered by agent-ava',
  timestamp: ASOF,
});
fundEscrow(state, { escrowId: blocked.id, payer: echo, amount: 500, timestamp: ASOF + 60 });
emit(state, 'escrow_opened', { id: blocked.id, beneficiary: resolveAgent(state, 'agent-ava').address, amount: 500, categories: blocked.categories });
emit(state, 'escrow_funded', { id: blocked.id, amount: 500 });
try {
  releaseEscrow(state, { escrowId: blocked.id, timestamp: ASOF + 120, approver: state.registry });
  say('  release -> RELEASED (this should not happen)');
} catch (error) {
  emit(state, 'escrow_release_refused', { id: blocked.id, reason: error.message });
  say(`  client-echo opens the same escrow for agent-ava`);
  say(`  funded ${fmtNum(500)} credits`);
  say(`  release -> REFUSED: ${pretty(String(error.message).replace('the release is refused: ', ''))}`);
  say(`  note the composite score of agent-ava was ${ava.composite.toFixed(2)} - it is not consulted`);
}
say('');
say('  the escrow history of client-echo:');
for (const entry of escrowHistory(state, echo)) {
  say(`    ${entry.id}  ${entry.status.padEnd(8)} ${fmtNum(entry.funded)} credits  [${entry.categories.join(', ')}]`);
  for (const line of entry.history) say(`      ${String(line.at).padStart(11)}  ${line.type.padEnd(16)} ${line.detail}`);
}
say('');

// ---------------------------------------------------------------- 3. score
say('STEP 3 - REPUTATION SCORE');
const card = issueCard(state, { agent: 'agent-ava', asOf: ASOF, timestamp: ASOF });
say(`  the passport is exported and signed by the registry`);
say(`    card id            ${card.id}`);
say(`    score as read      ${card.composite.toFixed(2)}  (gates: ${card.gates.pass ? 'all clear' : `refused - ${card.gates.failed.join(', ')}`})`);
say(`    chain link         prevCardHash ${card.prevCardHash.slice(0, 16)}...`);

const verified = verifyCard(card);
say(`  anybody can verify it, offline:  ok=${verified.ok}  (content ${verified.contentOk}, signature ${verified.signatureOk}, scores recomputed ${verified.scoresMatch})`);

const tampered = JSON.parse(JSON.stringify(card));
tampered.composite = 99.99;
const tamperedCheck = verifyCard(tampered);
say(`  tamper with the composite ->  ok=${tamperedCheck.ok}  (content ${tamperedCheck.contentOk}, signature ${tamperedCheck.signatureOk}, scores recomputed ${tamperedCheck.scoresMatch})`);

const later = verifyCard(card, { asOf: ASOF + 180 * DAY });
say(`  the same card read 180 days later -> composite ${later.composite.toFixed(2)} (scores recomputed, never stored)`);
say('');

say('SUMMARY - the books');
say(`  attestations on file    ${Object.keys(state.attestations).length}`);
say(`  escrows                 ${state.escrowOrder.length} (1 released, 1 refused)`);
say(`  events                  ${state.events.length}, hash chain ${state.events.every((event, index) => (index === 0 ? event.prevHash === '0'.repeat(64) : event.prevHash === state.events[index - 1].hash)) ? 'VERIFIED' : 'BROKEN'}`);
say(`  final state hash        ${state.events.length ? state.events[state.events.length - 1].hash : hash({})}`);
say('');
say('  every number above comes from running the code; nothing is hard-coded.');
say('  re-run: node scripts/demo.mjs   (identical output, byte for byte)');

if (asJson) {
  const trace = {
    protocol: 'passport',
    track: 'Open Innovation',
    bounty: 'bnty_0415',
    asOf: ASOF,
    attestationCount: Object.keys(state.attestations).length,
    passport: ava,
    card,
    cardVerification: {
      ok: verified.ok,
      contentOk: verified.contentOk,
      signatureOk: verified.signatureOk,
      scoresMatch: verified.scoresMatch,
    },
    escrows: state.escrowOrder.map((id) => state.escrows[id]),
    events: state.events,
    stateHash: hash(state.events),
  };
  console.log(JSON.stringify(trace, null, 2));
} else {
  fs.writeFileSync(path.join(root, 'docs/demo-transcript.txt'), `${lines.join('\n')}\n`);
}
