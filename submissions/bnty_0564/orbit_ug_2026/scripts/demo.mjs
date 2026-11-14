import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDemo, TRACK_CODE, BOUNTY_ID } from '../src/engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const { snapshot, transcript, publicRecord } = runDemo();

// On-chain deployment record (written by the deployment step). Optional: the
// demo must run on a fresh clone where it does not exist yet.
const deploymentPath = path.join(rootDir, 'docs', 'deployment.json');
let deploymentBlock = 'on-chain deployment: not yet recorded';
if (fs.existsSync(deploymentPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    // Render a CURATED summary, not the whole record: the raw deployment.json contains the
    // ciphertext and the engagement inputs, which would blow the transcript (and the PNG
    // rendered from it) wide. The full record stays in docs/deployment.json.
    const ORDER = [
      ['contract', 'contract account'],
      ['deploy_tx', 'deploy tx'],
      ['pool_funding_tx', 'pool funding tx'],
      ['open_job_tx', 'open_job tx'],
      ['negative_case_tx', 'forged opening tx (REFUSED)'],
      ['negative_case_refused', 'forged opening refused'],
      ['settle_tx', 'settle tx (payout)'],
      ['wasm_sha256', 'contract wasm sha256'],
    ];
    const lines = [];
    for (const [k, label] of ORDER) {
      if (raw[k] !== undefined && raw[k] !== null) {
        lines.push(`  ${label}: ${raw[k]}`);
      }
    }
    if (raw.crosscheck) {
      lines.push(`  commitment (on-chain == off-chain): ${raw.crosscheck.on_chain_sha256}`);
      lines.push(`  cross-check match: ${raw.crosscheck.match}`);
    }
    lines.push('  full record: docs/deployment.json');
    deploymentBlock = ['on-chain deployment:', ...lines].join('\n');
  } catch (err) {
    deploymentBlock = `on-chain deployment: unreadable deployment.json (${err.message})`;
  }
}

const out = `${transcript}${deploymentBlock}\n`;

fs.writeFileSync(path.join(rootDir, 'docs', 'demo-transcript.txt'), out, 'utf8');
fs.writeFileSync(
  path.join(rootDir, 'docs', 'demo-trace.json'),
  JSON.stringify({ ...publicRecord, chainVerified: snapshot.chainVerified, headHash: snapshot.headHash }, null, 2) + '\n',
  'utf8'
);
process.stdout.write(out);
