import { buildRetentionLabSnapshot, createRetentionLabChecklist } from '../service-retention-lab.mjs';

export function createRetentionLabOpsRoutes(basePath = '/ops/retention-lab') {
  const snapshot = buildRetentionLabSnapshot();
  return [
    { id: 'retention-lab.ops.health', method: 'GET', path: basePath + '/health', checklist: createRetentionLabChecklist(snapshot) },
    { id: 'retention-lab.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'retention-lab.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
