import { buildAudienceSyncSnapshot, createAudienceSyncChecklist } from '../service-audience-sync.mjs';

export function createAudienceSyncOpsRoutes(basePath = '/ops/audience-sync') {
  const snapshot = buildAudienceSyncSnapshot();
  return [
    { id: 'audience-sync.ops.health', method: 'GET', path: basePath + '/health', checklist: createAudienceSyncChecklist(snapshot) },
    { id: 'audience-sync.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'audience-sync.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
