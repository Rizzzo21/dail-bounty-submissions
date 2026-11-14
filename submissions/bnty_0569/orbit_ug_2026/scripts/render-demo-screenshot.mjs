// scripts/render-demo-screenshot.mjs - capture the REAL demo output and build the page that
// renders it. This replaces the hand-drawn docs/demo-screenshot.svg that used to fake a
// terminal and print "PASS" for every step (bnty_0569 fix item 3: "Replace the text-banner
// SVG with a real screenshot of the demo running").
//
// HONESTY CONTRACT OF THIS SCRIPT:
//   * the text in the screenshot is the byte-for-byte stdout of `node scripts/demo.mjs`,
//     captured through a real pty (`script -qec`), not retyped and not reconstructed;
//   * the HTML is generated from that capture file, never from a hand-written copy;
//   * the script re-reads the capture and ASSERTS the HTML contains exactly that text, so a
//     later edit to the demo cannot silently make the screenshot a lie.
//
// Usage:  node scripts/render-demo-screenshot.mjs
// Writes: docs/demo-capture.txt, docs/demo-screenshot.html

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const docsDir = path.join(rootDir, 'docs');

// ---- 1. capture the demo's real stdout through a pty ---------------------------------
const res = spawnSync('script', ['-qec', 'node scripts/demo.mjs', '/dev/null'], {
  cwd: rootDir,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
});
if (res.status !== 0) {
  console.error('demo failed under a pty:', res.status, res.stderr);
  process.exit(1);
}
const captured = res.stdout.replace(/\r\n/g, '\n');
fs.writeFileSync(path.join(docsDir, 'demo-capture.txt'), captured, 'utf8');

// ---- 2. build the page from the capture ----------------------------------------------
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function clsFor(line) {
  if (/^===/.test(line)) return 'c-head';
  if (/^\[STEP/.test(line)) return 'c-step';
  if (/^ {2}Summary:/.test(line)) return 'c-sum';
  if (/^ {2}Metrics:/.test(line)) return 'c-met';
  if (/^ {2}Hash:/.test(line)) return 'c-hash';
  if (/^ {2}\w/.test(line)) return 'c-state';
  return '';
}

const body = captured
  .split('\n')
  .map((l) => {
    const c = clsFor(l);
    return c ? `<span class="${c}">${esc(l)}</span>` : esc(l);
  })
  .join('\n');

const html = `<!doctype html>
<meta charset="utf-8">
<title>TREZU-SOCIAL demo - real captured output</title>
<style>
  :root { color-scheme: dark; }
  html,body { margin:0; padding:0; background:#0b0e14; }
  .frame { padding:26px; background:#0b0e14; }
  .win { background:#11151c; border:1px solid #2a3140; border-radius:12px; overflow:hidden;
         box-shadow:0 18px 50px rgba(0,0,0,.55); }
  .bar { background:#171c26; border-bottom:1px solid #2a3140; padding:10px 16px; display:flex;
         align-items:center; gap:8px; }
  .dot { width:12px; height:12px; border-radius:50%; display:inline-block; }
  .title { color:#8b94a7; font:13px/1 ui-sans-serif,system-ui,sans-serif; margin-left:10px; }
  pre { margin:0; padding:20px 22px 24px; color:#d7dce5;
        font:13px/1.55 ui-monospace,"DejaVu Sans Mono",Menlo,Consolas,monospace;
        white-space:pre; }
  .c-head { color:#e3b341; font-weight:700; }
  .c-step { color:#79c0ff; font-weight:700; }
  .c-sum  { color:#a5d6ff; }
  .c-met  { color:#8b949e; }
  .c-hash { color:#7ee787; }
  .c-state{ color:#d2a8ff; }
</style>
<div class="frame">
  <div class="win">
    <div class="bar">
      <span class="dot" style="background:#ff5f57"></span>
      <span class="dot" style="background:#febc2e"></span>
      <span class="dot" style="background:#28c840"></span>
      <span class="title">node scripts/demo.mjs &nbsp;&mdash;&nbsp; trezu-social-money</span>
    </div>
    <pre id="out">${body}</pre>
  </div>
</div>
`;

// ---- 3. assert the page really contains the captured text ----------------------------
const fromHtml = html
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
if (!fromHtml.includes(captured.trimEnd())) {
  console.error('FAIL: the generated page does not contain the captured output verbatim');
  process.exit(1);
}
fs.writeFileSync(path.join(docsDir, 'demo-screenshot.html'), html, 'utf8');

// ---- 4. report -----------------------------------------------------------------------
const required = ['1,200', '3,800', '48,800', '450', '78', 'REFUSED'];
const missing = required.filter((r) => !captured.includes(r));
if (missing.length) {
  console.error('FAIL: captured output is missing expected values:', missing.join(', '));
  process.exit(1);
}
console.log('captured bytes :', Buffer.byteLength(captured));
console.log('capture file   : docs/demo-capture.txt');
console.log('page file      : docs/demo-screenshot.html');
console.log('verbatim check : OK (page contains the captured text)');
console.log('required values:', required.join(', '), '-> all present');
