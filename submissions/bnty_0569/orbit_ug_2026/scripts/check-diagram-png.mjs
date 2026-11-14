// scripts/check-diagram-png.mjs
//
// Proves that docs/architecture.png is NOT a clipped render of docs/architecture.svg.
//
// WHY THIS EXISTS: headless Chrome renders a standalone SVG inside a viewport that is SHORTER
// than the window size you pass (window 1200 -> viewport ~1113 CSS px on this host). The
// screenshot then silently loses everything below that line: the first published PNG had a
// blank bottom band and was missing four text labels, one rect and one caption. Nothing in
// the PNG looks wrong to the eye, so the defect is invisible unless you MEASURE it.
//
// WHAT IT DOES: decodes the PNG (zlib inflate + the 5 PNG row filters), finds the lowest row
// that still carries ink, converts it to SVG user units, and compares it against the lowest
// y actually drawn in the SVG. If the PNG's last ink is more than TOLERANCE_CSS above the
// SVG's last drawn element, the render was clipped -> exit 1.
//
// Usage: node scripts/check-diagram-png.mjs [pngPath] [svgPath]
// Exit 0 = complete, 1 = clipped, 2 = could not read the inputs (instrument failure).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pngPath = process.argv[2] || path.join(rootDir, 'docs', 'architecture.png');
const svgPath = process.argv[3] || path.join(rootDir, 'docs', 'architecture.svg');

// How far below the last drawn element the PNG's last ink may sit, in CSS px.
const TOLERANCE_CSS = 12;
// A row is "ink" if any sampled pixel is clearly darker than the page background.
const INK_LEVEL = 245;
// Sample every Nth pixel of a row (the diagram is high-contrast; sampling is safe).
const SAMPLE_STEP = 7;

function die(msg, code) {
  console.error(msg);
  process.exit(code);
}

// ----------------------------------------------------------------------------------- SVG
if (!fs.existsSync(svgPath)) die('missing ' + svgPath, 2);
const svg = fs.readFileSync(svgPath, 'utf8');

const vb = svg.match(/viewBox="([^"]+)"/);
if (!vb) die('the SVG has no viewBox', 2);
const parts = vb[1].trim().split(/[\s,]+/).map(Number);
const svgW = parts[2];
const svgH = parts[3];

// the lowest y that anything in the SVG actually draws to
let drawnBottom = 0;
const ys = [];
for (const m of svg.matchAll(/\b(?:y|y2|cy|cy2)="(-?[\d.]+)"/g)) ys.push(Number(m[1]));
for (const m of svg.matchAll(/points="([^"]+)"/g)) {
  for (const pt of m[1].trim().split(/\s+/)) {
    if (pt.includes(',')) {
      const y = Number(pt.split(',')[1]);
      if (Number.isFinite(y)) ys.push(y);
    }
  }
}
for (const m of svg.matchAll(/\bd="([^"]+)"/g)) {
  for (const pair of m[1].matchAll(/(-?[\d.]+)[ ,]+(-?[\d.]+)/g)) {
    const y = Number(pair[2]);
    if (Number.isFinite(y)) ys.push(y);
  }
}
for (const y of ys) if (y > drawnBottom) drawnBottom = y;

// ----------------------------------------------------------------------------------- PNG
if (!fs.existsSync(pngPath)) die('missing ' + pngPath, 2);
const buf = fs.readFileSync(pngPath);
if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') die('not a PNG', 2);
const width = buf.readUInt32BE(16);
const height = buf.readUInt32BE(20);
const colorType = buf[25];
const bitDepth = buf[24];
if (colorType !== 2 || bitDepth !== 8) die('unsupported PNG (want colortype 2, depth 8)', 2);

const idat = [];
let off = 8;
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.subarray(off + 4, off + 8).toString('ascii');
  if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
  off += 12 + len;
}
let raw;
try {
  raw = zlib.inflateSync(Buffer.concat(idat));
} catch (e) {
  die('could not inflate the PNG image data: ' + e.message, 2);
}

const bpp = 3;
const stride = width * bpp;
if (raw.length < height * (stride + 1)) die('truncated PNG image data', 2);

const rowHasInk = [];
{
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[x] = (line[x] + pr) & 255;
      }
    }
    let ink = 0;
    for (let x = 0; x < stride; x += bpp * SAMPLE_STEP) {
      if (line[x] < INK_LEVEL || line[x + 1] < INK_LEVEL || line[x + 2] < INK_LEVEL) ink++;
    }
    rowHasInk.push(ink > 0);
    prev = line;
  }
}

let lastInk = -1;
for (let y = height - 1; y >= 0; y--) {
  if (rowHasInk[y]) { lastInk = y; break; }
}
let firstInk = -1;
for (let y = 0; y < height; y++) {
  if (rowHasInk[y]) { firstInk = y; break; }
}
if (lastInk < 0) die('the PNG contains no ink at all', 1);

// The PNG may be a higher-DPR render of the SVG, so map rows back to SVG user units by
// comparing the PNG's own aspect against the SVG's drawn width.
const pngAspect = width / height;
const svgAspect = svgW / svgH;
// scale = PNG px per SVG user unit, derived from the width (the SVG is drawn at its natural
// width by Chrome), and the vertical scale follows from the row index.
const pxPerUnit = width / svgW;
const lastInkSvgY = lastInk / pxPerUnit;

console.log('svg                : ' + path.relative(rootDir, svgPath) + '  viewBox ' + svgW + 'x' + svgH);
console.log('png                : ' + path.relative(rootDir, pngPath) + '  ' + width + 'x' + height);
console.log('svg last drawn y   : ' + drawnBottom.toFixed(1));
console.log('png last ink row  : ' + lastInk + '  -> svg y ' + lastInkSvgY.toFixed(1));
console.log('png first ink row : ' + firstInk);
console.log('missing height    : ' + (drawnBottom - lastInkSvgY).toFixed(1) + ' svg units (tolerance ' + TOLERANCE_CSS + ')');

if (drawnBottom - lastInkSvgY > TOLERANCE_CSS) {
  console.error('FAIL: the PNG is clipped - the bottom ' + (drawnBottom - lastInkSvgY).toFixed(1) +
    ' svg units of the diagram were never painted.');
  process.exit(1);
}
console.log('PASS: the PNG contains the whole diagram.');
