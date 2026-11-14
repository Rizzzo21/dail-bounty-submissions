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
  // A block only counts as a transcript excerpt if it actually quotes one:
  // at least one of its lines appears in the transcript. Without this, a
  // repository-layout block (which is indented too) had its dependency
  // version "near-sdk 5.17.2" compared against the demo's figures - a
  // figure the transcript was never supposed to contain. The rule is
  // "a block that quotes the transcript may not quote a figure the
  // transcript does not have", so a block that quotes nothing from the
  // transcript is out of scope.
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const hits = lines.filter((l) => transcript.includes(l));
  // Two hits, or one substantial one: a repository-layout block shares the
  // odd short line with the transcript ("scripts/"), and one coincidence is
  // not a quotation.
  const quoted = hits.length >= 2 || hits.some((l) => l.length >= 20);
  if (!quoted) continue;
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
