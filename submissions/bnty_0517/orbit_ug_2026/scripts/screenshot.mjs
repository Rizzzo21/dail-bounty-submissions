// Render the real demo transcript to an SVG screenshot (one <text> line per
// transcript line). No dependencies: the browser's own monospace font does the
// drawing, so the file is a few KB and opens anywhere.
//
//   node scripts/screenshot.mjs            > docs/demo-screenshot.svg
//   node scripts/screenshot.mjs --png      also writes docs/demo-screenshot.png
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const transcript = readFileSync('docs/demo-transcript.txt', 'utf8').split('\n');
const CHAR_W = 7.6;
const LINE_H = 15;
const PAD = 18;
const width = Math.round(96 * CHAR_W + PAD * 2);
const height = Math.round(transcript.length * LINE_H + PAD * 2);

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const body = transcript
  .map((line, i) => {
    const y = PAD + (i + 1) * LINE_H;
    const colour = line.startsWith('SCENARIO') || line.startsWith('SUMMARY')
      ? '#7fd1ff'
      : line.trim().startsWith('RULE') || line.trim().startsWith('supply')
        ? '#ffd479'
        : '#d7e3f4';
    return `  <text x="${PAD}" y="${y}" fill="${colour}" xml:space="preserve">${esc(line)}</text>`;
  })
  .join('\n');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#0b0f14"/>
  <g font-family="'DejaVu Sans Mono','Menlo','Consolas',monospace" font-size="12.5">
${body}
  </g>
</svg>
`;
process.stdout.write(svg);

if (process.argv.includes('--png')) {
  const svgPath = 'docs/demo-screenshot.svg';
  const pngPath = 'docs/demo-screenshot.png';
  writeFileSync(svgPath, svg);
  let made = false;
  if (existsSync('/usr/bin/rsvg-convert')) {
    try {
      execFileSync('/usr/bin/rsvg-convert', ['-o', pngPath, svgPath]);
      made = true;
    } catch { /* fall through to ImageMagick */ }
  }
  if (!made) {
    try {
      execFileSync('convert', ['-background', '#0d1117', svgPath, pngPath], { stdio: 'ignore' });
      made = true;
    } catch { /* fall through */ }
  }
  console.log(made ? `wrote ${svgPath} and ${pngPath}` : `wrote ${svgPath} (no SVG->PNG converter found)`);
}
