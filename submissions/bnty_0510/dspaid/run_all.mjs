#!/usr/bin/env node
// DAiL bnty_0485 — one-command reproduction: runs the model, sends the testnet evidence txs,
// executes the own checks and resolves every citation; full transcript goes to run_log.txt.
// Usage:  node run_all.mjs     Expected result: "RUN ALL: PASS" and exit 0.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.dirname(fileURLToPath(import.meta.url));
const STEPS = ['model.mjs', 'near_tx.mjs', 'checks.mjs', 'verify_citations.mjs'];

// House mirror fix (2026-11-14): a bare clone has no node_modules, so `node run_all.mjs`
// used to fail at import before reaching any step. Install the declared deps first when
// they are missing, so the documented one-command reproduction works from a bare clone.
if (!existsSync(path.join(outDir, 'node_modules', 'near-api-js'))) {
  console.log('node_modules/near-api-js missing — running `npm install` first (declared deps only)...');
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { stdio: 'inherit' });
}

writeFileSync(path.join(outDir, 'run_log.txt'), `# dail_bnty_0485 run_all transcript started ${new Date().toISOString()}\n`);
let failed = [];
for (const step of STEPS) {
  console.log(`\n########## ${step} ##########`);
  const header = `\n$ node ${step}   (${new Date().toISOString()})\n`;
  appendFileSync(path.join(outDir, 'run_log.txt'), header);
  try {
    const text = execFileSync(process.execPath, [path.join(outDir, step)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(text);
    appendFileSync(path.join(outDir, 'run_log.txt'), text + `EXIT 0\n`);
  } catch (e) {
    const text = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    process.stdout.write(text);
    appendFileSync(path.join(outDir, 'run_log.txt'), text + `EXIT ${e.status ?? 'crash'}\n`);
    failed.push(step);
  }
}
console.log(`\nRUN ALL: ${failed.length ? 'FAIL (' + failed.join(', ') + ')' : 'PASS'}`);
appendFileSync(path.join(outDir, 'run_log.txt'), `\nRUN ALL: ${failed.length ? 'FAIL (' + failed.join(', ') + ')' : 'PASS'}\n`);
if (failed.length) process.exit(1);
