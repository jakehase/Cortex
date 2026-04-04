import { buildMultiBrandHqSnapshot, createMultiBrandHqChecklist } from '../service-multi-brand-hq.mjs';

export function createMultiBrandHqOpsRoutes(basePath = '/ops/multi-brand-hq') {
  const snapshot = buildMultiBrandHqSnapshot();
  return [
    { id: 'multi-brand-hq.ops.health', method: 'GET', path: basePath + '/health', checklist: createMultiBrandHqChecklist(snapshot) },
    { id: 'multi-brand-hq.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'multi-brand-hq.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
