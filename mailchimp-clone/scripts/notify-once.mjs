import fs from 'node:fs';
import { markNotifierDelivered, loadCampaign } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { PROGRAM_STATE_PATH, SUMMARY_PATH, NOTIFY_PATH } from './lib/full-clone-plan.mjs';

const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
const state = loadCampaign(PROGRAM_STATE_PATH);
if (!summary.supervisorConfirmedCompletion || state.supervisor.status !== 'green') {
  console.error('Supervisor has not confirmed full completion.');
  process.exit(1);
}
markNotifierDelivered(PROGRAM_STATE_PATH, 'mailchimp-full-clone delivered');
const notificationState = { delivered: true, deliveredAt: new Date().toISOString(), notifier: 'scripts/notify-once.mjs', supervisorStatus: state.supervisor.status, matrixStatus: summary.matrixStatus };
fs.writeFileSync(NOTIFY_PATH, JSON.stringify(notificationState, null, 2));
console.log(`Mailchimp full clone complete: supervisor=${state.supervisor.status}, matrix=${summary.matrixStatus}`);
