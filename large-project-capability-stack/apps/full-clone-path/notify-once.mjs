import fs from 'node:fs';
import { markNotifierDelivered } from '../../packages/campaign-runtime/index.mjs';
import { paths } from './plan.mjs';

const state = JSON.parse(fs.readFileSync(paths.programState, 'utf8'));
const summary = JSON.parse(fs.readFileSync(paths.completionSummary, 'utf8'));
if (!summary.supervisorConfirmedCompletion || state.supervisorStatus !== 'green') {
  console.error('Full-clone path supervisor is not green.');
  process.exit(1);
}

const finalCampaign = markNotifierDelivered(paths.campaign, `full-clone-path:${summary.surfaceMatrixStatus}`);
const payload = {
  delivered: true,
  deliveredAt: finalCampaign.notifier.deliveredAt,
  notifier: 'apps/full-clone-path/notify-once.mjs',
  supervisorStatus: state.supervisorStatus,
  surfaceMatrixStatus: summary.surfaceMatrixStatus,
  currentClaim: summary.currentClaim,
  targetClaim: summary.targetClaim,
  targetCurrentlyEligible: summary.targetCurrentlyEligible
};
fs.writeFileSync(paths.notification, JSON.stringify(payload, null, 2));
console.log(`Real-world-indistinguishable path qualification complete: supervisor=${state.supervisorStatus}, matrix=${summary.surfaceMatrixStatus}, current_claim=${summary.currentClaim}, target_eligible=${summary.targetCurrentlyEligible}`);
