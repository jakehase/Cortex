import fs from 'node:fs';
import { markNotifierDelivered, loadCampaign } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { paths, readJson, writeJson } from './lib/orchestrator-real-repo-clean-plan.mjs';

const summary = readJson(paths.completionSummary, null);
const state = loadCampaign(paths.campaignState);
if (!summary?.supervisorConfirmedCompletion || state?.supervisor?.status !== 'green') {
  console.error('Clean real-repo supervisor has not confirmed scoped completion.');
  process.exit(1);
}

markNotifierDelivered(paths.campaignState, 'orchestrator-real-repo-clean delivered');
writeJson(paths.notificationState, {
  delivered: true,
  deliveredAt: new Date().toISOString(),
  notifier: 'scripts/orchestrator-real-repo-clean-notify.mjs',
  supervisorStatus: state.supervisor.status,
  matrixStatus: summary.surfaceMatrixStatus,
  provenCoordinationScaleTier: summary.provenCoordinationScaleTier,
  qualificationMode: summary.qualificationMode,
  note: 'Clean real-repo orchestrator qualification delivered.'
});

console.log(`Clean real-repo qualification complete: supervisor=${state.supervisor.status}, tier=${summary.provenCoordinationScaleTier}`);
