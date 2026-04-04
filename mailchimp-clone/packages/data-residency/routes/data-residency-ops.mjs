import { buildDataResidencySnapshot, createDataResidencyChecklist } from '../service-data-residency.mjs';

export function createDataResidencyOpsRoutes(basePath = '/ops/data-residency') {
  const snapshot = buildDataResidencySnapshot();
  return [
    { id: 'data-residency.ops.health', method: 'GET', path: basePath + '/health', checklist: createDataResidencyChecklist(snapshot) },
    { id: 'data-residency.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'data-residency.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
