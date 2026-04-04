import { buildReferralEngineSnapshot, createReferralEngineChecklist } from '../service-referral-engine.mjs';

export function createReferralEngineOpsRoutes(basePath = '/ops/referral-engine') {
  const snapshot = buildReferralEngineSnapshot();
  return [
    { id: 'referral-engine.ops.health', method: 'GET', path: basePath + '/health', checklist: createReferralEngineChecklist(snapshot) },
    { id: 'referral-engine.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'referral-engine.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
