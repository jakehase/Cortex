import { buildLifecycleGridSnapshot, createLifecycleGridReadinessBoard } from '../service-lifecycle-grid.mjs';

export function createLifecycleGridOpsRoutes(basePath = '/ops/lifecycle-grid') {
  const snapshot = buildLifecycleGridSnapshot();
  return [
    { id: 'lifecycle-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleGridReadinessBoard(snapshot) },
    { id: 'lifecycle-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

