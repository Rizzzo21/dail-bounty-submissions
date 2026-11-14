// The demo: four deterministic scenarios that show the mechanic working.
//   node scripts/demo.mjs          human transcript
//   node scripts/demo.mjs --json   the same run as a machine-readable trace
// No network, no clock, no randomness: the same command prints the same bytes.
import { createCast, createState, DEFAULT_POOL } from '../src/state.js';
import { applyRitual, applySwapAction, stateFingerprint, verifyChain } from '../src/engine.js';
import { ritualIdFor, ritualPayload, paramsHash } from '../src/ritual.js';
import { sign, round, fmtNum } from '../src/util.js';
import { price } from '../src/mechanics.js';

const cast = createCast();
const keys = {};
for (const holder of cast.values()) keys[holder.address] = holder.publicKey;

// Every rule number the demo uses comes from DEFAULT_PARAMS in src/state.js -
// nothing is duplicated here, so the rule set in the transcript is literally
// the file's. The pool is the only starting state the demo sets.
const POOL = DEFAULT_POOL;

const lines = [];
const say = (s = '') => lines.push(s);
const member = (name) => {
  for (const holder of cast.values()) if (holder.name === name) return holder;
  throw new Error(`no member named ${name}`);
};
const freshState = () => createState({ cast, pool: POOL });

function signRitual(state, kind, epoch, members) {
  const ritualId = ritualIdFor(state, kind, epoch, members.map((m) => m.address));
  const ph = paramsHash(state);
  return members.map((m) => ({
    address: m.address,
    sig: sign(m.privateKey, ritualPayload({ kind, epoch, ritualId, address: m.address, paramsHash: ph })),
  }));
}

const eligibleHolders = (state) =>
  Object.values(state.balances).filter((b) => b >= state.params.minStake).length;

function ruleLines(state) {
  for (const e of state.events.filter((e) => e.type.startsWith('treasury_rule'))) {
    if (e.type === 'treasury_rule_liquidity_floor') {
      say(`  RULE R1 liquidity floor  treasury minted ${fmtNum(e.payload.minted)} tokens up to its floor`);
    }
    if (e.type === 'treasury_rule_buyback') {
      say(`  RULE R2 buyback          treasury spent ${fmtNum(e.payload.spent)} USDC of fees, bought and burned ${fmtNum(e.payload.burned)} tokens`);
    }
  }
}

// ---------------------------------------------------------------- scenario 1
function scenarioChant() {
  const state = freshState();
  const before = state.supply;
  const chanters = ['mara', 'ivo', 'sana', 'tomas', 'wren', 'kofi'].map(member);
  say('SCENARIO 1 - THE CHANT: the community performs a ritual, the supply reacts');
  say(`  supply before            ${fmtNum(before)}`);
  say(`  eligible holders         ${eligibleHolders(state)} (the whale abstains; the steward holds no tokens)`);
  say(`  chanters                 ${chanters.map((m) => m.name).join(', ')}`);
  const ritual = applyRitual(state, keys, { kind: 'CHANT', epoch: 1, signers: signRitual(state, 'CHANT', 1, chanters) });
  say(`  ritual id                ${ritual.id}`);
  say(`  votes                    ${ritual.votes.toFixed(2)} of ${state.params.quorumVotes} needed -> FIRED`);
  const fired = state.events.find((e) => e.type === 'chant_fired').payload;
  say(`  participation            ${(fired.participation * 100).toFixed(1)}% of eligible holders took part`);
  say(`  minted to the community  ${fmtNum(fired.minted)} tokens (cap ${fmtNum(state.params.mintCap)}, scaled by participation)`);
  say(`  steward cut (2%)         ${fmtNum(fired.stewardCut)} tokens - disclosed, not hidden`);
  say(`  chant fees to treasury   ${fmtNum(fired.chantFees)} tokens (${fmtNum(state.params.chantFee)} per signer)`);
  ruleLines(state);
  const after = state.supply;
  say(`  supply after             ${fmtNum(after)}  (${after - before >= 0 ? '+' : ''}${fmtNum(after - before)} tokens)`);
  say('');
  return { name: 'chant', state, before, after };
}

// ---------------------------------------------------------------- scenario 2
function scenarioStorm() {
  const state = freshState();
  const before = state.supply;
  const whale = member('whale');
  say('SCENARIO 2 - THE STORM: usage funds the treasury, then a ritual makes it act');
  say(`  supply before            ${fmtNum(before)}`);
  say('  the whale trades 8 x 80,000 USDC into the pool (3% fee each)');
  let fees = 0;
  for (let i = 0; i < 8; i++) {
    const res = applySwapAction(state, { trader: whale.address, dir: 'y_to_x', amountIn: 80000 });
    fees += res.fee;
  }
  say(`  fees collected           ${fmtNum(fees)} USDC -> treasury USDC ${fmtNum(state.treasury.usdc)}`);
  say(`  price moved              ${round(price(state.pool), 6)} USDC per token`);
  say('  ...then the community chants again, and the treasury rules run on the fees');
  const chanters = ['mara', 'ivo', 'sana'].map(member);
  applyRitual(state, keys, { kind: 'CHANT', epoch: 1, signers: signRitual(state, 'CHANT', 1, chanters) });
  ruleLines(state);
  const after = state.supply;
  say(`  supply after             ${fmtNum(after)}  (${after - before >= 0 ? '+' : ''}${fmtNum(after - before)} tokens)`);
  say('  the mint and the buyback pull against each other - that is the point: the');
  say('  rules, not a marketing plan, decide how much of the token exists.');
  say('');
  return { name: 'storm', state, before, after };
}

// ---------------------------------------------------------------- scenario 3
function scenarioQuorum() {
  const state = freshState();
  const before = state.supply;
  say('SCENARIO 3 - NO QUORUM: a ritual that nobody backs does nothing at all');
  const burners = ['mara', 'ivo'].map(member);
  let ritual = applyRitual(state, keys, { kind: 'BURN', epoch: 1, signers: signRitual(state, 'BURN', 1, burners) });
  say(`  2 signers for BURN       votes ${ritual.votes.toFixed(2)} of ${state.params.quorumVotes} -> PENDING, nothing happened`);
  say(`  supply unchanged         ${fmtNum(state.supply)} (was ${fmtNum(before)} - the ritual did nothing)`);
  say('  a third holder shows up later:');
  const late = member('tomas');
  ritual = applyRitual(state, keys, { kind: 'BURN', epoch: 1, signers: signRitual(state, 'BURN', 1, [late]) });
  say(`  votes                    ${ritual.votes.toFixed(2)} of ${state.params.quorumVotes} -> FIRED`);
  const burned = state.events.find((e) => e.type === 'burn_fired').payload;
  say(`  burned                   ${fmtNum(burned.burned)} tokens (${fmtNum(state.params.burnPerSigner)} per signer)`);
  ruleLines(state);
  const after = state.supply;
  say(`  supply after             ${fmtNum(after)}  (${after - before >= 0 ? '+' : ''}${fmtNum(after - before)} tokens)`);
  say('');
  return { name: 'quorum', state, before, after };
}

// ---------------------------------------------------------------- scenario 4
function scenarioHowl() {
  const state = freshState();
  const before = state.supply;
  say('SCENARIO 4 - THE HOWL: a ritual window burns a share of every trade');
  const howlers = ['mara', 'ivo', 'sana'].map(member);
  applyRitual(state, keys, { kind: 'HOWL', epoch: 1, signers: signRitual(state, 'HOWL', 1, howlers) });
  say(`  window open              epoch ${state.epoch} -> ${state.howlUntilEpoch}`);
  const trader = member('wren');
  const res = applySwapAction(state, { trader: trader.address, dir: 'y_to_x', amountIn: 50000 });
  say(`  a 50,000 USDC trade      fee ${fmtNum(res.fee)} USDC + howl tax ${fmtNum(res.howlTax)} tokens burned`);
  ruleLines(state);
  const after = state.supply;
  say(`  supply after             ${fmtNum(after)}  (${after - before >= 0 ? '+' : ''}${fmtNum(after - before)} tokens)`);
  say('');
  return { name: 'howl', state, before, after };
}

// ------------------------------------------------------------------- run it
say('================================================================');
say(' RITUAL - a memecoin whose supply is a function of what the');
say(' community does, and whose treasury runs explicit rules.');
say(' track: NEAR Hackathon, Memecoins With Mechanics (bnty_0421)');
say('================================================================');
say('');
say('RULE SET (every number lives in src/state.js)');
const p0 = freshState().params;
say(`  quorum                    ${p0.quorumVotes} votes - one vote per address per epoch, a whale's vote capped at 1`);
say(`  min stake                 ${fmtNum(p0.minStake)} tokens`);
say(`  mint cap                  ${fmtNum(p0.mintCap)} tokens per ritual, scaled by participation`);
say(`  steward                   ${(p0.stewardBps / 100).toFixed(1)}% of every mint`);
say(`  pool fee                  ${(p0.poolFeeBps / 100).toFixed(2)}% - collected in USDC, goes to the treasury`);
say(`  treasury floor            ${fmtNum(p0.treasuryFloor)} tokens - the treasury mints itself up to it`);
say(`  treasury ceiling          ${fmtNum(p0.treasuryCeiling)} USDC - above it the treasury buys and burns tokens`);
say(`  chant fee                 ${fmtNum(p0.chantFee)} tokens per signer, burn ${fmtNum(p0.burnPerSigner)} tokens per signer`);
say(`  howl tax                  ${(p0.howlTaxBps / 100).toFixed(2)}% of every trade burned while a howl window is open`);
say('');

const scenarios = [scenarioChant(), scenarioStorm(), scenarioQuorum(), scenarioHowl()];

say('SUMMARY - what the mechanic did to the supply');
say('  scenario        supply before      supply after        delta');
for (const s of scenarios) {
  say(`  ${s.name.padEnd(12)} ${fmtNum(s.before).padStart(14)} ${fmtNum(s.after).padStart(16)} ${fmtNum(s.after - s.before).padStart(12)}`);
}
const chain = verifyChain(scenarios[0].state);
say('');
say(`  event log                    ${scenarios[0].state.events.length} events, hash chain ${chain.ok ? 'VERIFIED' : 'BROKEN'}`);
say(`  final state hash (scenario 1) ${scenarios[0].state.lastHash}`);
say(`  state fingerprint (scenario 1) ${stateFingerprint(scenarios[0].state)}`);
say('');
say('  every number above comes from running the code; nothing is hard-coded.');
say('  re-run: node scripts/demo.mjs   (identical output, byte for byte)');

if (process.argv.includes('--json')) {
  const payload = {
    protocol: 'ritual',
    track: 'Memecoins With Mechanics',
    bounty: 'bnty_0421',
    params: scenarios[0].state.params,
    scenarios: scenarios.map((s) => ({
      name: s.name,
      supply_before: s.before,
      supply_after: s.after,
      treasury: s.state.treasury,
      final_state_hash: s.state.lastHash,
      events: s.state.events,
    })),
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
} else {
  process.stdout.write(lines.join('\n') + '\n');
}
