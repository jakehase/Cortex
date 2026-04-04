import { buildPartnerSuccessSnapshot, createPartnerSuccessChecklist } from '../service-partner-success.mjs';

export function createPartnerSuccessOpsRoutes(basePath = '/ops/partner-success') {
  const snapshot = buildPartnerSuccessSnapshot();
  return [
    { id: 'partner-success.ops.health', method: 'GET', path: basePath + '/health', checklist: createPartnerSuccessChecklist(snapshot) },
    { id: 'partner-success.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'partner-success.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
