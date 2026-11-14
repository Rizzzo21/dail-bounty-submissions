// Every decimal or thousands-separated number quoted in a README's transcript
// excerpts must appear in the real transcript. A stale figure in the docs is
// a defect, even when the code is right.
import { readFileSync } from 'node:fs';
const [readmePath, transcriptPath] = process.argv.slice(2);
const readme = readFileSync(readmePath, 'utf8');
const transcript = readFileSync(transcriptPath, 'utf8');
const blocks = [...readme.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
const NUM = /(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.,])\d+\.\d+(?![\d])/g;
const inTranscript = new Set((transcript.match(NUM) ?? []).map((n) => n.replace(/,/g, '')));
const sameNumber = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;
const missing = [];
for (const block of blocks) {
  if (!/^\s{2,}\S/m.test(block)) continue; // not a transcript excerpt
  for (const raw of block.match(NUM) ?? []) {
    const n = raw.replace(/,/g, '');
    if (![...inTranscript].some((t) => sameNumber(t, n))) missing.push(`${raw}  |  ${block.split('\n').find((l) => l.includes(raw))?.trim()}`);
  }
}
if (missing.length) {
  console.log(`FAIL  ${missing.length} number(s) quoted in ${readmePath} are not in the transcript:`);
  for (const m of missing) console.log(`      ${m}`);
  process.exit(1);
}
console.log(`OK    every quoted figure in ${readmePath} is in the transcript`);
