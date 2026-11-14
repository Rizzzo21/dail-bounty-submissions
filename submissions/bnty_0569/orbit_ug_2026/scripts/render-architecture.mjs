// scripts/render-architecture.mjs
//
// Hand-authored architecture diagram for TREZU-SOCIAL.
//
// HONESTY CONTRACT OF THIS SCRIPT:
//   * the SVG is written by hand here - explicit <rect>/<text>/<path> with explicit x/y
//     coordinates. No image generation, no auto-layout library, no diagram package.
//   * every label that appears in the diagram is written out verbatim, character for
//     character (including the double spaces and the "<->" arrows), inside CDATA so the
//     XML never mangles it and the source file still greps exactly.
//   * every number in the diagram is a real number produced by src/engine.mjs from
//     src/fixtures.mjs (budget 5,000 / gate 65 / alice 82 -> APPROVED 1,200 /
//     remaining 3,800 / vault 50,000 -> 48,800 / bob 60 -> 78 + 450 USDC /
//     eve 41 -> REFUSED). Nothing here is invented.
//   * the on-chain caption box is rendered ONLY when docs/onchain.json exists; the file
//     carries the deployed contract account and the transaction hashes.
//
// Usage:  node scripts/render-architecture.mjs
// Writes: docs/architecture.svg (source of truth), docs/architecture.png (render)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const docsDir = path.join(rootDir, 'docs');

const CHROME = '/home/node/.cache/ms-playwright/chromium-1148/chrome-linux/chrome';
const W = 1700;
const H = 1200;

// ---------------------------------------------------------------------------------------
// palette - colour-blind safe (blue / teal / amber / purple / slate on a near-white page)
// ---------------------------------------------------------------------------------------
const C = {
  page: '#f7f9fc',
  ink: '#10233f',
  muted: '#4a5a70',
  arrow: '#2f3e52',
  rule: '#c8d2e0',

  blue: { line: '#1f5fa8', fill: '#eaf2fb', ink: '#10406f' },
  teal: { line: '#0f766e', fill: '#e6f6f4', ink: '#0b4f4a', solid: '#0f766e' },
  amber: { line: '#a15c00', fill: '#fdf3e3', ink: '#7a4400', solid: '#a15c00' },
  purple: { line: '#6d28d9', fill: '#f1ebfd', ink: '#4c1d95' },
  slate: { line: '#334155', fill: '#eef2f7', ink: '#1e293b' },
  panel: { line: '#c3c8e8', fill: '#eef0fb', ink: '#2b3350' },
  dark: { line: '#0a1a30', fill: '#10233f', ink: '#e6edf5', accent: '#8fd3ff' },
};

const MONO = 'DejaVu Sans Mono, Liberation Mono, monospace';
const SANS = 'DejaVu Sans, Liberation Sans, Arial, sans-serif';

// char-width factors (DejaVu family) used to prove no text overflows its box
const W_MONO = 0.602;
const W_SANS = 0.62;

// ---------------------------------------------------------------------------------------
// tiny SVG helpers
// ---------------------------------------------------------------------------------------
const out = [];
const warnings = [];

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function textWidth(str, size, family) {
  const factor = family === MONO ? W_MONO : W_SANS;
  return String(str).length * size * factor;
}

// one <text> element; the content goes into CDATA so it is byte-for-byte what was asked
function text(x, y, str, opts = {}) {
  const size = opts.size ?? 15;
  const family = opts.family ?? MONO;
  const fill = opts.fill ?? C.ink;
  const weight = opts.weight ?? 'normal';
  const anchor = opts.anchor ?? 'middle';
  const s = String(str);
  const w = textWidth(s, size, family);
  if (opts.maxWidth && w > opts.maxWidth) {
    warnings.push(`text overflows: "${s}" (${Math.round(w)}px > ${opts.maxWidth}px)`);
  }
  out.push(
    `<text x="${x}" y="${y}" font-family="${escAttr(family)}" font-size="${size}" ` +
      `font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" ` +
      `xml:space="preserve"><![CDATA[${s}]]></text>`
  );
  return w;
}

function rect(x, y, w, h, opts = {}) {
  const rx = opts.rx ?? 0;
  const fill = opts.fill ?? 'none';
  const stroke = opts.stroke ?? 'none';
  const sw = opts.sw ?? 0;
  out.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ` +
      `stroke="${stroke}" stroke-width="${sw}"/>`
  );
}

function line(x1, y1, x2, y2, opts = {}) {
  const stroke = opts.stroke ?? C.arrow;
  const sw = opts.sw ?? 2;
  out.push(
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`
  );
}

// arrow with an explicitly drawn, filled head (no <marker> defs - chromium is flaky with them)
function arrow(x1, y1, x2, y2, opts = {}) {
  const stroke = opts.stroke ?? C.arrow;
  const sw = opts.sw ?? 2.4;
  const head = opts.head ?? 11;
  line(x1, y1, x2, y2, { stroke, sw });
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const w2 = head * 0.46;
  out.push(
    `<path d="M ${x2} ${y2} L ${(bx + px * w2).toFixed(2)} ${(by + py * w2).toFixed(2)} ` +
      `L ${(bx - px * w2).toFixed(2)} ${(by - py * w2).toFixed(2)} Z" fill="${stroke}"/>`
  );
}

// a labelled box: rounded rect + centred text lines
function box({ x, y, w, h, palette, lines, rx = 10, sw = 2 }) {
  rect(x, y, w, h, { rx, fill: palette.fill, stroke: palette.line, sw });
  for (const ln of lines) {
    const size = ln.size ?? 15;
    const fam = ln.family ?? MONO;
    const tw = textWidth(ln.t, size, fam);
    const pad = 14;
    if (tw > w - pad * 2) {
      warnings.push(
        `box text too wide: "${ln.t}" (${Math.round(tw)}px > ${w - pad * 2}px inside a ${w}px box)`
      );
    }
    if (ln.t.length * 0 + 1 > 0 && ln.y < y + size * 0.8) {
      warnings.push(`box text above the top edge: "${ln.t}"`);
    }
    if (ln.y > y + h - 2) {
      warnings.push(`box text below the bottom edge: "${ln.t}"`);
    }
    text(ln.x ?? x + w / 2, ln.y, ln.t, {
      size,
      family: fam,
      fill: ln.fill ?? palette.ink,
      weight: ln.weight ?? 'normal',
      anchor: ln.anchor ?? 'middle',
      maxWidth: w - pad * 2,
    });
  }
}

function sectionHeading(x, y, label) {
  text(x, y, label, { size: 19, family: SANS, weight: 'bold', fill: '#5b3fa8', anchor: 'start' });
}

// ---------------------------------------------------------------------------------------
// the on-chain caption (only when docs/onchain.json exists)
// ---------------------------------------------------------------------------------------
const onchainPath = path.join(docsDir, 'onchain.json');
let onchain = null;
if (fs.existsSync(onchainPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(onchainPath, 'utf8'));
    if (raw && typeof raw.contract_account === 'string' && raw.txs && typeof raw.txs === 'object') {
      onchain = raw;
    } else {
      console.warn('WARN: docs/onchain.json does not have the expected shape - caption box skipped');
    }
  } catch (e) {
    console.warn('WARN: docs/onchain.json is not valid JSON - caption box skipped:', e.message);
  }
}

const TX_LABELS = [
  ['create', 'create account'],
  ['deploy', 'deploy + init'],
  ['spend', 'spend (approved)'],
  ['reward', 'reward payout'],
  ['gate', 'reputation gate (refused)'],
];

// ---------------------------------------------------------------------------------------
// build the SVG
// ---------------------------------------------------------------------------------------
out.push(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
    `font-kerning="normal">`
);
out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${C.page}"/>`);

// ---- title --------------------------------------------------------------------------
text(850, 44, 'TREZU-SOCIAL - shared-budget governance as a Sputnik DAO v2 policy extension', {
  size: 27,
  family: SANS,
  weight: 'bold',
  fill: C.ink,
});
text(850, 72, 'one shared epoch budget, a reputation gate, a quorum-gated reward stream - all of it one policy extension', {
  size: 14.5,
  family: SANS,
  fill: C.muted,
});

// ---- row 1: the shared epoch budget ---------------------------------------------------
sectionHeading(60, 112, '1 - THE SHARED EPOCH BUDGET');
box({
  x: 430,
  y: 124,
  w: 840,
  h: 112,
  palette: C.blue,
  rx: 12,
  lines: [
    { t: 'Shared epoch budget  q4-growth', y: 156, size: 17, weight: 'bold' },
    { t: 'total 5,000 USDC  |  epoch Q4', y: 186, size: 15 },
    { t: 'reputation gate: reputation >= 65', y: 212, size: 15 },
  ],
});

// ---- row 2: the reputation gate (two branches) ---------------------------------------
sectionHeading(60, 274, '2 - THE REPUTATION GATE');

const GATE_A_X = 440;
const GATE_B_X = 1260;

box({
  x: 70,
  y: 288,
  w: 740,
  h: 54,
  palette: C.teal,
  lines: [{ t: 'ops-alice.near  reputation 82 >= gate 65', y: 320, size: 15.5 }],
});
arrow(GATE_A_X, 344, GATE_A_X, 384);
rect(290, 386, 300, 48, { rx: 24, fill: C.teal.solid, stroke: C.teal.solid, sw: 1 });
text(GATE_A_X, 418, 'APPROVED', { size: 19, family: SANS, weight: 'bold', fill: '#ffffff' });
arrow(GATE_A_X, 434, GATE_A_X, 474);
box({
  x: 250,
  y: 476,
  w: 380,
  h: 54,
  palette: C.teal,
  lines: [{ t: 'spend 1,200 USDC', y: 509, size: 16 }],
});

box({
  x: 890,
  y: 288,
  w: 740,
  h: 54,
  palette: C.amber,
  lines: [{ t: 'newcomer-eve.near  reputation 41 < gate 65', y: 320, size: 15.5 }],
});
arrow(GATE_B_X, 344, GATE_B_X, 384);
rect(1030, 386, 460, 48, { rx: 24, fill: C.amber.solid, stroke: C.amber.solid, sw: 1 });
text(GATE_B_X, 418, 'REFUSED (reputation_below_minimum)', {
  size: 17,
  family: SANS,
  weight: 'bold',
  fill: '#ffffff',
});
arrow(GATE_B_X, 434, GATE_B_X, 474);
box({
  x: 970,
  y: 476,
  w: 580,
  h: 54,
  palette: C.amber,
  lines: [{ t: 'budget unchanged at 3,800 USDC', y: 509, size: 16 }],
});

// ---- row 3: state after the approved spend -------------------------------------------
sectionHeading(60, 566, '3 - STATE AFTER THE APPROVED SPEND');
arrow(GATE_A_X, 530, GATE_A_X, 576);
arrow(GATE_B_X, 530, GATE_B_X, 576);
box({
  x: 200,
  y: 578,
  w: 480,
  h: 66,
  palette: C.slate,
  lines: [{ t: 'remaining epoch budget  3,800 USDC', y: 617, size: 15.5 }],
});
box({
  x: 880,
  y: 578,
  w: 560,
  h: 66,
  palette: C.slate,
  lines: [{ t: 'multisig vault  50,000 -> 48,800 USDC', y: 617, size: 15.5 }],
});

// ---- row 4: the reward stream --------------------------------------------------------
sectionHeading(60, 686, '4 - THE REWARD STREAM');
box({
  x: 180,
  y: 700,
  w: 400,
  h: 64,
  palette: C.purple,
  lines: [{ t: 'milestone M-104  verified by 3/3 stewards', y: 738, size: 15 }],
});
arrow(580, 732, 618, 732);
box({
  x: 620,
  y: 700,
  w: 460,
  h: 64,
  palette: C.purple,
  lines: [{ t: 'reward engine releases 450 USDC + 18 reputation', y: 738, size: 15 }],
});
arrow(1080, 732, 1118, 732);
box({
  x: 1120,
  y: 700,
  w: 400,
  h: 64,
  palette: C.purple,
  lines: [{ t: 'builder-bob.near  reputation 60 -> 78', y: 738, size: 15 }],
});
arrow(1320, 764, 1320, 788);
box({
  x: 1140,
  y: 790,
  w: 520,
  h: 58,
  palette: C.purple,
  lines: [{ t: 'builder-bob.near reward balance  450 USDC', y: 825, size: 15.5 }],
});

// ---- row 5: the real Sputnik DAO v2 mapping (tinted panel) ----------------------------
rect(60, 858, 1580, 138, { rx: 14, fill: C.panel.fill, stroke: C.panel.line, sw: 2 });
sectionHeading(90, 886, '5 - THE REAL SPUTNIK DAO v2 MAPPING');
const MAPPINGS = [
  'shared epoch budget  <->  AddBounty proposal (bounty carries token + amount)',
  'reward payout        <->  bounty_done(id) -> BountyDone proposal -> payout when voted',
  'reputation gate      <->  a custom VOTING POLICY in the Sputnik DAO v2 policy engine',
  "multisig vault       <->  the DAO's own treasury / the bounty pool",
];
MAPPINGS.forEach((m, i) => {
  text(90, 916 + i * 22, m, { size: 15.5, fill: C.panel.ink, anchor: 'start' });
});

// ---- bottom band: on-chain caption OR legend -----------------------------------------
const LEGEND = [
  [C.teal.solid, 'approved path - reputation gate passed'],
  [C.amber.solid, 'refused path - gate not met, state unchanged'],
  [C.purple.line, 'reward stream and policy extension'],
  [C.slate.line, 'shared budget, vault and derived state'],
];

if (onchain) {
  rect(60, 1008, 1580, 162, { rx: 12, fill: C.dark.fill, stroke: C.dark.line, sw: 2 });
  text(90, 1040, `deployed on NEAR testnet: ${onchain.contract_account}`, {
    size: 17,
    weight: 'bold',
    fill: C.dark.accent,
    anchor: 'start',
  });
  TX_LABELS.forEach(([key, label], i) => {
    const hash = onchain.txs[key] ?? 'n/a';
    text(90, 1068 + i * 22, `${label}: ${hash}`, {
      size: 14,
      fill: C.dark.ink,
      anchor: 'start',
    });
  });
  // compact legend on the right of the caption
  text(1200, 1040, 'LEGEND', { size: 14, weight: 'bold', fill: C.dark.accent, anchor: 'start' });
  LEGEND.forEach(([col, lab], i) => {
    const y = 1068 + i * 24;
    rect(1200, y - 11, 22, 13, { rx: 3, fill: col, stroke: col, sw: 1 });
    text(1232, y, lab, { size: 14, fill: C.dark.ink, anchor: 'start' });
  });
} else {
  rect(60, 1008, 1580, 162, { rx: 12, fill: C.slate.fill, stroke: C.rule, sw: 2 });
  text(90, 1040, 'LEGEND', { size: 15, weight: 'bold', fill: C.ink, anchor: 'start' });
  LEGEND.forEach(([col, lab], i) => {
    const y = 1072 + i * 24;
    rect(90, y - 11, 22, 13, { rx: 3, fill: col, stroke: col, sw: 1 });
    text(122, y, lab, { size: 14, fill: C.ink, anchor: 'start' });
  });
  text(900, 1040, 'on-chain caption omitted: docs/onchain.json is not present in this build', {
    size: 14,
    fill: C.muted,
    anchor: 'start',
  });
}

// ---- footer --------------------------------------------------------------------------
text(
  850,
  1190,
  'every number shown is computed by src/engine.mjs and reproduced by the deployed contract',
  { size: 14, family: SANS, fill: C.muted }
);

out.push('</svg>');
const svg = out.join('\n') + '\n';

if (warnings.length) {
  console.error('LAYOUT WARNINGS:');
  for (const w of warnings) console.error('  - ' + w);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------
// write + render
// ---------------------------------------------------------------------------------------
fs.mkdirSync(docsDir, { recursive: true });
const svgPath = path.join(docsDir, 'architecture.svg');
fs.writeFileSync(svgPath, svg, 'utf8');

const res = spawnSync(
  CHROME,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--disable-dev-shm-usage',
    // make headless chrome exit promptly instead of hanging on the zygote
    '--virtual-time-budget=2000',
    '--timeout=15000',
    '--force-device-scale-factor=2',
    // The window must be TALLER than the SVG: headless Chrome's viewport is shorter than
    // the window size (window 1200 -> viewport ~1113 CSS px on this host), and a standalone
    // SVG is then CLIPPED - the first published PNG silently lost its bottom labels.
    '--window-size=1700,1320',
    `--screenshot=${path.join(docsDir, 'architecture.png')}`,
    pathToFileURL(svgPath).href,
  ],
  { encoding: 'utf8', timeout: 120000 }
);

if (res.error) {
  console.error('chrome failed to start:', res.error.message);
  process.exit(1);
}
if (res.status !== 0) {
  console.error('chrome exited', res.status, res.stderr);
  process.exit(1);
}

const pngPath = path.join(docsDir, 'architecture.png');
if (!fs.existsSync(pngPath)) {
  console.error('chrome did not produce docs/architecture.png');
  process.exit(1);
}
const png = fs.readFileSync(pngPath);
const sig = png.subarray(0, 8).toString('hex');
if (sig !== '89504e470d0a1a0a') {
  console.error('docs/architecture.png is not a PNG');
  process.exit(1);
}
const w = png.readUInt32BE(16);
const h = png.readUInt32BE(20);

console.log('svg            : docs/architecture.svg  (' + Buffer.byteLength(svg) + ' bytes)');
console.log('png            : docs/architecture.png  (' + png.length + ' bytes, ' + w + 'x' + h + ')');
console.log('on-chain caption: ' + (onchain ? 'present (' + onchain.contract_account + ')' : 'omitted (no docs/onchain.json)'));
console.log('layout         : no overflow / no out-of-box text');

// The render is only allowed to succeed if the PNG actually contains the whole diagram.
// This is the control that would have caught the clipped first render.
const check = spawnSync(process.execPath, [path.join(__dirname, 'check-diagram-png.mjs')], {
  encoding: 'utf8', timeout: 120000
});
process.stdout.write(check.stdout || '');
process.stderr.write(check.stderr || '');
if (check.status !== 0) {
  console.error('render aborted: the PNG it just produced is clipped or unreadable.');
  process.exit(1);
}
