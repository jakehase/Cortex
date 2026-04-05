import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROGRAM_STATE_PATH = path.join(ROOT, 'artifacts', 'full_audit_campaign', 'program_state.json');
const SUMMARY_PATH = path.join(ROOT, 'artifacts', 'full_audit_campaign', 'completion_summary.json');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

const program = readJson(PROGRAM_STATE_PATH, {});
const summary = readJson(SUMMARY_PATH, {});
const ready = Boolean(program?.stopAllowed && (program?.supervisor?.status === 'green' || program?.supervisor?.blocker));
console.log(JSON.stringify({ ready, supervisor: program?.supervisor || null, summary }, null, 2));
process.exit(ready ? 0 : 1);
