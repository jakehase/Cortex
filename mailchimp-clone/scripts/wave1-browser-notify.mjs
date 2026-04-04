import fs from 'node:fs';
import { markNotifierDelivered, loadCampaign } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { PROGRAM_STATE_PATH, SUMMARY_PATH, NOTIFY_PATH } from './lib/wave1-browser-foundation-plan.mjs';

const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
const state = loadCampaign(PROGRAM_STATE_PATH);
if (!summary.supervisorConfirmedCompletion || state.supervisor.status !== 'green') {
  console.error('Wave 1 browser supervisor has not confirmed scoped completion.');
  process.exit(1);
}
markNotifierDelivered(PROGRAM_STATE_PATH, 'wave1-browser-foundation delivered');
const notificationState = {
  delivered: true,
  deliveredAt: new Date().toISOString(),
  notifier: 'scripts/wave1-browser-notify.mjs',
  supervisorStatus: state.supervisor.status,
  matrixStatus: summary.matrixStatus,
  note: 'Wave 1 browser realism foundation delivered; not full project completion.'
};
fs.writeFileSync(NOTIFY_PATH, JSON.stringify(notificationState, null, 2));
console.log(`Wave 1 browser foundation complete: supervisor=${state.supervisor.status}, matrix=${summary.matrixStatus}`);
