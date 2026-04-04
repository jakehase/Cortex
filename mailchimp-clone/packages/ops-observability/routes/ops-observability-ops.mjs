import { buildOpsObservabilitySnapshot, createOpsObservabilityChecklist } from '../service-ops-observability.mjs';

export function createOpsObservabilityOpsRoutes(basePath = '/ops/ops-observability') {
  const snapshot = buildOpsObservabilitySnapshot();
  return [
    { id: 'ops-observability.ops.health', method: 'GET', path: basePath + '/health', checklist: createOpsObservabilityChecklist(snapshot) },
    { id: 'ops-observability.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'ops-observability.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
