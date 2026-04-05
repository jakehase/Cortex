import { buildDataNavigatorSnapshot, createDataNavigatorReadinessBoard } from '../service-data-navigator.mjs';

export function createDataNavigatorOpsRoutes(basePath = '/ops/data-navigator') {
  const snapshot = buildDataNavigatorSnapshot();
  return [
    { id: 'data-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataNavigatorReadinessBoard(snapshot) },
    { id: 'data-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

