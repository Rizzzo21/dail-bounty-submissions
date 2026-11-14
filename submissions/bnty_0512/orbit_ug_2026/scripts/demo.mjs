#!/usr/bin/env node
// Human-readable demo transcript.
//
//   node scripts/demo.mjs              # print the transcript
//   node scripts/demo.mjs --json       # print the raw JSON trace
//   node scripts/demo.mjs --out FILE   # write the JSON trace to FILE
//
// Deterministic: same seed in, same bytes out.
import { writeFileSync } from 'node:fs';
import { runSimulation, DEFAULT_SEED } from '../src/simulation.js';

const NEAR = (uNEAR) => `${(uNEAR / 1_000_000).toFixed(4)} NEAR`;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const outIndex = args.indexOf('--out');
const outFile = outIndex >= 0 ? args[outIndex + 1] : null;
const seedIndex = args.indexOf('--seed');
const seed = seedIndex >= 0 ? args[seedIndex + 1] : DEFAULT_SEED;

const result = await runSimulation({ seed });

if (asJson) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  const lines = [];
  const p = (s = '') => lines.push(s);

  p('================================================================');
  p(' NEAR SWARM MARKET -- agent coordination demo');
  p(` seed: ${result.seed}   rounds: ${result.rounds}`);
  p('================================================================');
  p('');
  p('Legend: [round] event ...');
  p('');

  let round = null;
  for (const ev of result.trace) {
    if (ev.round !== round) {
      round = ev.round;
      p('');
      p(`---------------- ${round === 0 ? 'SETUP' : `ROUND ${round}`} ----------------`);
    }
    const t = ev.type;
    switch (t) {
      case 'job_posted':
        p(`  JOB POSTED      ${ev.job_id}  skill=${ev.skill}  budget=${NEAR(ev.budget)}  reputation gate>=${ev.min_reputation}${ev.shielded ? '  [shielded payment]' : ''}`);
        p(`                   "${ev.label}"`);
        break;
      case 'bid_placed':
        p(`  BID             ${ev.agent_id.padEnd(15)} price=${NEAR(ev.price).padStart(12)}  quality=${ev.quality.toFixed(3)}  rep=${ev.score}`);
        break;
      case 'bid_rejected':
        p(`  BID REJECTED    ${ev.agent_id.padEnd(15)} reason="${ev.error}"  (rep=${ev.score})`);
        break;
      case 'bid_skipped':
        p(`  NO BID          ${ev.agent_id.padEnd(15)} ${ev.reason}`);
        break;
      case 'vote_cast':
        p(`  VOTE            ${ev.agent_id.padEnd(15)} signed the digest it derived itself (quorum ${ev.quorum})`);
        break;
      case 'vote_withheld':
        p(`  VOTE WITHHELD   ${ev.agent_id.padEnd(15)} ${ev.reason}`);
        break;
      case 'job_awarded':
        p(`  AWARDED         ${ev.winner} wins ${ev.job_id} for ${NEAR(ev.price)} (quality ${ev.quality}, ${ev.votes_for}/${ev.quorum} votes)`);
        break;
      case 'consensus_failed':
        p(`  NO CONSENSUS    ${ev.job_id}: ${ev.votes_for} votes < quorum ${ev.quorum} -- ${ev.note}`);
        break;
      case 'job_settled':
        p(`  SETTLED         ${ev.winner} paid ${NEAR(ev.price)} (fee ${NEAR(ev.fee_to_social_money)} -> social money)`);
        p(`                   delivered quality ${ev.delivered_quality}, reputation now ${ev.reputation_score}${ev.revealed_amount ? `, revealed amount ${NEAR(ev.revealed_amount)}` : ''}`);
        break;
      case 'purchase_opened':
        p(`  COLLECTIVE BUY  ${ev.purchase_id}: unit ${NEAR(ev.unit_base)}, target ${ev.units_target} units, tiers ${JSON.stringify(ev.tiers)}`);
        break;
      case 'purchase_bid':
        p(`  BUY BID         ${ev.agent_id.padEnd(15)} units=${ev.units}  values unit at ${NEAR(ev.valuation_per_unit)}  max spend ${NEAR(ev.max_spend)}`);
        break;
      case 'purchase_settled':
        p(`  BUY SETTLED     ${ev.units} units @ ${NEAR(ev.unit_price)} each (gross ${NEAR(ev.gross_cost)})`);
        p(`                   social-money subsidy ${NEAR(ev.social_money_subsidy)}, total utility ${ev.total_utility}, fairness(gini) ${ev.fairness_gini}`);
        for (const a of ev.allocation) {
          p(`                     ${a.agent_id.padEnd(15)} units=${a.units}  pays ${NEAR(a.cost).padStart(12)}  utility ${a.utility}`);
        }
        break;
      case 'private_column_submitted':
        p(`  PRIVATE COLUMN  ${ev.agent_id.padEnd(15)} submitted column sum ${ev.column_sum}`);
        break;
      case 'private_aggregate_published':
        p(`  AGGREGATE       ${ev.aggregate} published (matches true sum: ${ev.matches_sum_of_private_values}, individual values published: ${ev.individual_values_published})`);
        break;
      case 'shielded_escrow_state':
        p(`  ESCROW (public) amount=${ev.public_amount}  commitment=${ev.commitment}...  ${ev.note}`);
        break;
      case 'simulation_finished':
        break;
      case 'privacy_pool_prefunded':
        p(`  POOL PREFUNDED  ${ev.amount} uNEAR in one lump -- ${ev.note}`);
        break;
      case 'agents_registered':
        p(`  AGENTS          registered: ${ev.agents.join(', ')}`);
        break;
      default:
        p(`  ${t.padEnd(16)} ${JSON.stringify(ev)}`);
    }
  }

  p('');
  p('---------------- FINAL STATE ----------------');
  p('  balances:');
  for (const [k, v] of Object.entries(result.final_balances)) {
    p(`    ${k.padEnd(28)} ${NEAR(v)}`);
  }
  p('  reputation scores:');
  for (const [k, v] of Object.entries(result.final_scores)) {
    p(`    ${k.padEnd(28)} ${v}`);
  }
  p(`  chain receipts: ${result.chain_receipts}`);
  p('');

  process.stdout.write(`${lines.join('\n')}\n`);
}

if (outFile) {
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
  process.stderr.write(`trace written to ${outFile}\n`);
}
