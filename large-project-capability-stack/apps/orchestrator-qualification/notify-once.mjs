import fs from 'node:fs';
import { markNotifierDelivered } from '../../packages/campaign-runtime/index.mjs';
import { paths } from './plan.mjs';

const state = JSON.parse(fs.readFileSync(paths.programState, 'utf8'));
const summary = JSON.parse(fs.readFileSync(paths.completionSummary, 'utf8'));
if (!summary.supervisorConfirmedCompletion || state.supervisorStatus !== 'green') {
  console.error('Orchestrator supervisor is not green.');
  process.exit(1);
}

const finalCampaign = markNotifierDelivered(paths.campaign, `multi-agent-orchestrator:${summary.surfaceMatrixStatus}:${summary.qualificationMode}`);
const payload = {
  delivered: true,
  deliveredAt: finalCampaign.notifier.deliveredAt,
  notifier: 'apps/orchestrator-qualification/notify-once.mjs',
  supervisorStatus: state.supervisorStatus,
  surfaceMatrixStatus: summary.surfaceMatrixStatus,
  provenCoordinationScaleTier: summary.provenCoordinationScaleTier,
  qualificationMode: summary.qualificationMode
};
fs.writeFileSync(paths.notification, JSON.stringify(payload, null, 2));
console.log(`Multi-agent orchestrator qualification complete: supervisor=${state.supervisorStatus}, matrix=${summary.surfaceMatrixStatus}, proven_scale_tier=${summary.provenCoordinationScaleTier}, mode=${summary.qualificationMode}`);
