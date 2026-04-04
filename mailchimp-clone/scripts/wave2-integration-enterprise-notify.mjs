import fs from 'node:fs';
import { markNotifierDelivered, loadCampaign } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { PROGRAM_STATE_PATH, SUMMARY_PATH, NOTIFY_PATH } from './lib/wave2-integration-enterprise-plan.mjs';

const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
const state = loadCampaign(PROGRAM_STATE_PATH);
if (!summary.supervisorConfirmedCompletion || state.supervisor.status !== 'green') {
  console.error('Wave 2 supervisor has not confirmed scoped completion.');
  process.exit(1);
}
markNotifierDelivered(PROGRAM_STATE_PATH, 'wave2-integration-enterprise delivered');
const notificationState = {
  delivered: true,
  deliveredAt: new Date().toISOString(),
  notifier: 'scripts/wave2-integration-enterprise-notify.mjs',
  supervisorStatus: state.supervisor.status,
  matrixStatus: summary.matrixStatus,
  note: 'Wave 2 integration realism + enterprise/admin/compliance breadth delivered; not full project completion.'
};
fs.writeFileSync(NOTIFY_PATH, JSON.stringify(notificationState, null, 2));
console.log(`Wave 2 integration/enterprise complete: supervisor=${state.supervisor.status}, matrix=${summary.matrixStatus}`);
