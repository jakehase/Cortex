import fs from 'node:fs';
import { markNotifierDelivered } from '../../packages/campaign-runtime/index.mjs';
import { paths } from './plan.mjs';

const state = JSON.parse(fs.readFileSync(paths.programState, 'utf8'));
const summary = JSON.parse(fs.readFileSync(paths.completionSummary, 'utf8'));
if (!summary.supervisorConfirmedCompletion || state.supervisorStatus !== 'green') {
  console.error('Qualification supervisor is not green.');
  process.exit(1);
}

const finalCampaign = markNotifierDelivered(paths.campaign, `qualification:${summary.surfaceMatrixStatus}`);
const payload = {
  delivered: true,
  deliveredAt: finalCampaign.notifier.deliveredAt,
  notifier: 'apps/qualification/notify-once.mjs',
  supervisorStatus: state.supervisorStatus,
  surfaceMatrixStatus: summary.surfaceMatrixStatus,
  highestAllowedClaim: summary.highestAllowedClaim
};
fs.writeFileSync(paths.notification, JSON.stringify(payload, null, 2));
console.log(`Qualification truth gate complete: supervisor=${state.supervisorStatus}, matrix=${summary.surfaceMatrixStatus}, safe_claim=${summary.highestAllowedClaim}`);
