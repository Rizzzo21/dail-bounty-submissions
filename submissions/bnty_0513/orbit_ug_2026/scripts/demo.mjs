// The demo: one asset, one lifecycle, six deterministic steps.
//   node scripts/demo.mjs          human transcript
//   node scripts/demo.mjs --json   the same run as a machine-readable trace
// No network, no wall clock: every timestamp is supplied below, so the run is
// reproducible byte for byte.
import { createParties, createState } from '../src/state.js';
import {
  accrueAction,
  clearParty,
  coverage,
  freezeParty,
  publishNav,
  redeemAction,
  registerAsset,
  signTransfer,
  stateFingerprint,
  subscribeAction,
  transferAction,
  verifyChain,
} from '../src/engine.js';
import { auditLedger } from '../src/ledger.js';
import { round, fmtNum } from '../src/util.js';

const T0 = 1800000000; // the issue timestamp, fixed
const DAY = 86400;
const MATURITY = T0 + 90 * DAY;
const ASSET = 't-bill-2026q4';

const cast = createParties();
const byName = new Map();
for (const holder of cast.values()) byName.set(holder.name, holder);
const addr = (name) => byName.get(name).address;
const nameOf = (address) => cast.get(address)?.name ?? address;
// print addresses as the names they stand for, so a rejection reads like a story
const pretty = (message) =>
  Object.keys(Object.fromEntries(cast)).reduce(
    (text, address) => text.split(address).join(nameOf(address)),
    message,
  );

const lines = [];
const say = (s = '') => lines.push(s);
const state = createState({ parties: cast });

// ---------------------------------------------------------------- 1. issue
say('STEP 1 - THE REGISTRY ISSUES A REAL-WORLD ASSET');
const asset = registerAsset(state, {
  admin: addr('issuer'),
  id: ASSET,
  name: 'US Treasury Bill 2026Q4',
  kind: 'T-BILL',
  totalSupply: 1000000,
  maturity: MATURITY,
  yieldBps: 450,
  timestamp: T0,
});
say(`  asset                    ${asset.name} (${asset.kind})`);
say(`  face value available     ${fmtNum(asset.totalSupply)} USDC`);
say(`  coupon                   ${(asset.yieldBps / 100).toFixed(2)}% a year`);
say(`  matures at              ${new Date(asset.maturity * 1000).toISOString()} (90 days after issue)`);
say('');

// ---------------------------------------------------------------- 2. clear
say('STEP 2 - THE COMPLIANCE GATE');
for (const name of ['fund-avery', 'fund-birch', 'fund-cobalt', 'retail-dana']) {
  clearParty(state, { admin: addr('issuer'), address: addr(name), status: 'VERIFIED', timestamp: T0 });
}
say('  cleared to hold         fund-avery (US), fund-birch (TW), fund-cobalt (SG), retail-dana (TW)');
say('  left uncleared          retail-eli (DE) - and DE is not an allowed jurisdiction for this asset anyway');
try {
  subscribeAction(state, { investor: addr('retail-eli'), assetId: ASSET, amount: 10000, timestamp: T0 });
} catch (error) {
  say(`  retail-eli tries to buy  -> REJECTED: ${pretty(error.message)}`);
}
say('');

// ---------------------------------------------------------------- 3. subscribe
say('STEP 3 - THE INVESTORS SUBSCRIBE');
for (const [name, amount] of [['fund-avery', 100000], ['fund-birch', 250000], ['retail-dana', 5000]]) {
  subscribeAction(state, { investor: addr(name), assetId: ASSET, amount, timestamp: T0 });
  say(`  ${name.padEnd(12)} subscribed ${fmtNum(amount)} USDC -> ${fmtNum(amount)} units`);
}
const cov1 = coverage(state, ASSET);
say(`  issuer reserve           ${fmtNum(cov1.reserve)} USDC backing ${fmtNum(cov1.claims)} USDC of claims (covered: ${cov1.covered})`);
say('');

// ---------------------------------------------------------------- 4. oracle
say('STEP 4 - THE ORACLE PUBLISHES A NET ASSET VALUE');
publishNav(state, { feed: addr('feed'), assetId: ASSET, nav: 1.02, timestamp: T0 + 60 * DAY });
say('  feed publishes NAV       1.0200 USDC per unit');
const sig = signTransfer(state, addr('fund-avery'), {
  to: addr('retail-dana'),
  assetId: ASSET,
  units: 2000,
  timestamp: T0 + 60 * DAY,
});
const tr = transferAction(state, {
  from: addr('fund-avery'),
  to: addr('retail-dana'),
  assetId: ASSET,
  units: 2000,
  timestamp: T0 + 60 * DAY,
  signature: sig,
});
say(`  fund-avery sells 2,000 units to retail-dana at ${fmtNum(tr.price)} USDC (signed by the seller)`);
// the same signed bytes, one more time: the signature is good for exactly one
// transfer, so the replay is refused and no unit moves
try {
  transferAction(state, {
    from: addr('fund-avery'),
    to: addr('retail-dana'),
    assetId: ASSET,
    units: 2000,
    timestamp: T0 + 60 * DAY,
    signature: sig,
  });
} catch (error) {
  say(`  the same signed transfer, replayed -> REJECTED: ${pretty(error.message)}`);
}
try {
  transferAction(state, {
    from: addr('fund-birch'),
    to: addr('retail-eli'),
    assetId: ASSET,
    units: 1000,
    timestamp: T0 + 60 * DAY,
    signature: signTransfer(state, addr('fund-birch'), { to: addr('retail-eli'), assetId: ASSET, units: 1000, timestamp: T0 + 60 * DAY }),
  });
} catch (error) {
  say(`  fund-birch tries to sell to retail-eli -> REJECTED: ${pretty(error.message)}`);
}
say('');

// ---------------------------------------------------------------- 5. accrue
say('STEP 5 - THE YIELD ACCRUES (90 days after issue, 30 for the new holder)');
accrueAction(state, { assetId: ASSET, timestamp: MATURITY });
for (const [address, holder] of Object.entries(asset.holders)) {
  if (holder.units > 0 || holder.accrued > 0) {
    const name = nameOf(address);
    say(`  ${name.padEnd(12)} ${fmtNum(holder.units)} units, accrued yield ${holder.accrued.toFixed(4)} USDC`);
  }
}
const cov2 = coverage(state, ASSET);
say(`  issuer reserve           ${fmtNum(cov2.reserve)} USDC backing ${fmtNum(cov2.claims)} USDC of claims (covered: ${cov2.covered})`);
say('');

// ---------------------------------------------------------------- 6. freeze + redeem
say('STEP 6 - A FREEZE, AND THEN THE REDEMPTION');
freezeParty(state, { admin: addr('issuer'), address: addr('fund-birch'), frozen: true, reason: 'sanctions review' });
try {
  redeemAction(state, { holder: addr('fund-birch'), assetId: ASSET, timestamp: MATURITY });
} catch (error) {
  say(`  fund-birch tries to redeem -> REJECTED: ${pretty(error.message)}`);
}
const avery = asset.holders[addr('fund-avery')];
const averyFace = avery.units;
const averyYield = avery.accrued;
const redemption = redeemAction(state, { holder: addr('fund-avery'), assetId: ASSET, timestamp: MATURITY });
say(`  fund-avery redeems        face ${fmtNum(averyFace)} + accrued yield ${averyYield.toFixed(4)}`);
say(`                           gross ${redemption.gross.toFixed(4)} USDC, fee ${redemption.fee.toFixed(4)}, net ${redemption.net.toFixed(4)}`);
say(`  fund-avery USDC balance  ${fmtNum(state.balances[addr('fund-avery')])}`);
say('');

// ---------------------------------------------------------------- summary
say('SUMMARY - the books');
const audit = auditLedger(state.ledger);
const cov3 = coverage(state, ASSET);
say(`  journal entries           ${state.ledger.entries.length}`);
say(`  debits ${fmtNum(audit.debit)} USDC = credits ${fmtNum(audit.credit)} USDC  (balanced: ${audit.ok})`);
say(`  accounts                  ${Object.keys(audit.accounts).length}`);
say(`  issuer reserve            ${fmtNum(cov3.reserve)} USDC`);
say(`  claims outstanding        ${fmtNum(cov3.claims)} USDC (covered: ${cov3.covered})`);
say(`  registry fees kept        ${fmtNum(state.ledger.accounts[`fee:${ASSET}`] || 0)} USDC`);
say(`  event log                 ${state.events.length} events, hash chain ${verifyChain(state).ok ? 'VERIFIED' : 'BROKEN'}`);
say(`  final state hash          ${state.lastHash}`);
say('');
say('  the last journal entry, verbatim:');
const last = state.ledger.entries[state.ledger.entries.length - 1];
for (const leg of last.legs) {
  say(`    ${leg.debit ? `debit  ${fmtNum(leg.debit)}` : `credit ${fmtNum(leg.credit)}`}  ${leg.account}`);
}
say('');
say('  every number above comes from running the code; nothing is hard-coded.');
say('  re-run: node scripts/demo.mjs   (identical output, byte for byte)');

if (process.argv.includes('--json')) {
  process.stdout.write(
    JSON.stringify(
      {
        protocol: 'anchor',
        track: 'Real-World Money',
        bounty: 'bnty_0414',
        asset: ASSET,
        timestamps: { issue: T0, maturity: MATURITY },
        final_state_hash: state.lastHash,
        coverage: cov3,
        audit,
        events: state.events,
        ledger: state.ledger,
      },
      null,
      2,
    ) + '\n',
  );
} else {
  process.stdout.write(lines.join('\n') + '\n');
}
