#!/usr/bin/env node
// Generate a screenshot-ready image of the demo transcript.
//
//   node scripts/screenshot.mjs            # -> docs/demo-screenshot.svg
//   node scripts/screenshot.mjs --png      # -> also docs/demo-screenshot.png
//                                            (only if ImageMagick/rsvg is present)
//
// The SVG is produced with the Node standard library only -- no external tool
// is required. The PNG is a convenience: if neither `rsvg-convert` nor
// ImageMagick's `convert` is installed, the script says so and still exits 0
// with a usable SVG.
//
// The image is a faithful rendering of the real transcript, produced by running
// the real demo. Nothing is hand-drawn or faked.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { runSimulation, DEFAULT_SEED } from '../src/simulation.js';

const WIDTH = 116; // characters per line
const FONT_SIZE = 15;
const LINE_HEIGHT = 20;
const PAD = 22;

const C = {
  bg: '#0d1117',
  fg: '#c9d1d9',
  dim: '#6e7681',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  cyan: '#58a6ff',
  magenta: '#bc8cff',
};

/** The transcript as the demo prints it, rebuilt from the same source. */
async function transcriptLines(seed) {
  const result = await runSimulation({ seed });
  const lines = [];
  const push = (s = '') => lines.push(s);
  const NEAR = (u) => `${(u / 1_000_000).toFixed(4)} NEAR`;

  push('NEAR SWARM MARKET -- agent coordination demo');
  push(`seed: ${result.seed}   rounds: ${result.rounds}`);
  push('');
  push('Legend: [round] event ...');
  push('');

  let round = null;
  for (const ev of result.trace) {
    if (ev.round !== round) {
      round = ev.round;
      push('');
      push(`---------------- ${round === 0 ? 'SETUP' : `ROUND ${round}`} ----------------`);
    }
    switch (ev.type) {
      case 'job_posted':
        push(`  JOB POSTED      ${ev.job_id}  skill=${ev.skill}  budget=${NEAR(ev.budget)}  reputation gate>=${ev.min_reputation}${ev.shielded ? '  [shielded payment]' : ''}`);
        push(`                   "${ev.label}"`);
        break;
      case 'bid_placed':
        push(`  BID             ${ev.agent_id.padEnd(15)} price=${NEAR(ev.price).padStart(12)}  quality=${ev.quality.toFixed(3)}  rep=${ev.score}`);
        break;
      case 'bid_rejected':
        push(`  BID REJECTED    ${ev.agent_id.padEnd(15)} reason="${ev.error}"  (rep=${ev.score})`);
        break;
      case 'bid_skipped':
        push(`  NO BID          ${ev.agent_id.padEnd(15)} ${ev.reason}`);
        break;
      case 'vote_cast':
        push(`  VOTE            ${ev.agent_id.padEnd(15)} signed the digest it derived itself (quorum ${ev.quorum})`);
        break;
      case 'vote_withheld':
        push(`  VOTE WITHHELD   ${ev.agent_id.padEnd(15)} ${ev.reason}`);
        break;
      case 'job_awarded':
        push(`  AWARDED         ${ev.winner} wins ${ev.job_id} for ${NEAR(ev.price)} (quality ${ev.quality}, ${ev.votes_for}/${ev.quorum} votes)`);
        break;
      case 'consensus_failed':
        push(`  NO CONSENSUS    ${ev.job_id}: ${ev.votes_for} votes < quorum ${ev.quorum} -- ${ev.note}`);
        break;
      case 'job_settled':
        push(`  SETTLED         ${ev.winner} paid ${NEAR(ev.price)} (fee ${NEAR(ev.fee_to_social_money)} -> social money)`);
        push(`                   delivered quality ${ev.delivered_quality}, reputation now ${ev.reputation_score}${ev.revealed_amount ? `, revealed amount ${NEAR(ev.revealed_amount)}` : ''}`);
        break;
      case 'purchase_opened':
        push(`  COLLECTIVE BUY  ${ev.purchase_id}: unit ${NEAR(ev.unit_base)}, target ${ev.units_target} units, tiers ${JSON.stringify(ev.tiers)}`);
        break;
      case 'purchase_bid':
        push(`  BUY BID         ${ev.agent_id.padEnd(15)} units=${ev.units}  values unit at ${NEAR(ev.valuation_per_unit)}  max spend ${NEAR(ev.max_spend)}`);
        break;
      case 'purchase_settled':
        push(`  BUY SETTLED     ${ev.units} units @ ${NEAR(ev.unit_price)} each (gross ${NEAR(ev.gross_cost)})`);
        push(`                   social-money subsidy ${NEAR(ev.social_money_subsidy)}, total utility ${ev.total_utility}, fairness(gini) ${ev.fairness_gini}`);
        for (const a of ev.allocation) {
          push(`                     ${a.agent_id.padEnd(15)} units=${a.units}  pays ${NEAR(a.cost).padStart(12)}  utility ${a.utility}`);
        }
        break;
      case 'private_column_submitted':
        push(`  PRIVATE COLUMN  ${ev.agent_id.padEnd(15)} submitted column sum ${ev.column_sum}`);
        break;
      case 'private_aggregate_published':
        push(`  AGGREGATE       ${ev.aggregate} published (matches true sum: ${ev.matches_sum_of_private_values}, individual values published: ${ev.individual_values_published})`);
        break;
      case 'shielded_escrow_state':
        push(`  ESCROW (public) amount=${ev.public_amount}  commitment=${ev.commitment}...  ${ev.note}`);
        break;
      case 'privacy_pool_prefunded':
        push(`  POOL PREFUNDED  ${ev.amount} uNEAR in one lump -- ${ev.note}`);
        break;
      case 'agents_registered':
        push(`  AGENTS          registered: ${ev.agents.join(', ')}`);
        break;
      case 'simulation_finished':
        break;
      default:
        push(`  ${ev.type.padEnd(16)} ${JSON.stringify(ev)}`);
    }
  }

  push('');
  push('---------------- FINAL STATE ----------------');
  push('  balances:');
  for (const [k, v] of Object.entries(result.final_balances)) {
    push(`    ${k.padEnd(28)} ${NEAR(v)}`);
  }
  push('  reputation scores:');
  for (const [k, v] of Object.entries(result.final_scores)) {
    push(`    ${k.padEnd(28)} ${v}`);
  }
  push(`  chain receipts: ${result.chain_receipts}`);
  return lines;
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function colourFor(line) {
  if (line.startsWith('  BID REJECTED') || line.startsWith('  NO CONSENSUS')) return C.red;
  if (line.startsWith('  AWARDED')) return C.green;
  if (line.startsWith('  SETTLED') || line.startsWith('  AGGREGATE')) return C.green;
  if (line.startsWith('  VOTE WITHHELD')) return C.yellow;
  if (line.startsWith('  COLLECTIVE BUY') || line.startsWith('  BUY SETTLED')) return C.magenta;
  if (line.startsWith('  ESCROW') || line.startsWith('  PRIVATE COLUMN')) return C.cyan;
  if (line.startsWith('----') || line.startsWith('NEAR SWARM')) return C.cyan;
  if (line.startsWith('  balances') || line.startsWith('  reputation')) return C.dim;
  return C.fg;
}

function toSvg(lines) {
  const height = PAD * 2 + lines.length * LINE_HEIGHT;
  const width = PAD * 2 + WIDTH * FONT_SIZE * 0.6;
  const body = lines
    .map(
      (line, i) =>
        `<text x="${PAD}" y="${PAD + i * LINE_HEIGHT}" fill="${colourFor(line)}" ` +
        `xml:space="preserve">${esc(line)}</text>`,
    )
    .join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${height}" viewBox="0 0 ${Math.round(width)} ${height}">
  <rect width="100%" height="100%" fill="${C.bg}"/>
  <g font-family="'DejaVu Sans Mono','Menlo','Consolas',monospace" font-size="${FONT_SIZE}px">
  ${body}
  </g>
</svg>
`;
}

const lines = await transcriptLines(DEFAULT_SEED);
const svg = toSvg(lines);
const svgPath = 'docs/demo-screenshot.svg';
writeFileSync(svgPath, svg);
console.log(`wrote ${svgPath} (${lines.length} lines, ${svg.length} bytes)`);

if (args().includes('--png')) {
  const pngPath = 'docs/demo-screenshot.png';
  let made = false;
  if (existsSync('/usr/bin/rsvg-convert')) {
    try {
      execFileSync('/usr/bin/rsvg-convert', ['-o', pngPath, svgPath]);
      made = true;
    } catch { /* fall through */ }
  }
  if (!made) {
    try {
      execFileSync('convert', ['-background', '#0d1117', svgPath, pngPath], { stdio: 'ignore' });
      made = true;
    } catch { /* fall through */ }
  }
  if (made) {
    console.log(`wrote ${pngPath}`);
  } else {
    console.log('no SVG->PNG converter found (rsvg-convert / ImageMagick).');
    console.log('the SVG is a complete, uploadable artifact on its own.');
  }
}

function args() {
  return process.argv.slice(2);
}
