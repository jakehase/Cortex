import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { watchCampaignReadiness } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROGRAM_STATE_PATH = path.join(ROOT, 'artifacts', 'full_audit_campaign', 'program_state.json');
const SUMMARY_PATH = path.join(ROOT, 'artifacts', 'full_audit_campaign', 'completion_summary.json');
const NOTIFY_PATH = path.join(ROOT, 'artifacts', 'full_audit_campaign', 'notification_state.json');

const { ready, program, summary } = watchCampaignReadiness({
  programStatePath: PROGRAM_STATE_PATH,
  summaryPath: SUMMARY_PATH,
  notifyStatePath: NOTIFY_PATH,
  cwd: ROOT,
  notifyArgs: ['scripts/full-audit-campaign-notify.mjs']
});

console.log(JSON.stringify({ ready, supervisor: program?.supervisor || null, summary }, null, 2));
process.exit(ready ? 0 : 1);
