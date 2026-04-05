import { buildLifecycleIndexSnapshot, createLifecycleIndexReadinessBoard } from '../service-lifecycle-index.mjs';

export function createLifecycleIndexOpsRoutes(basePath = '/ops/lifecycle-index') {
  const snapshot = buildLifecycleIndexSnapshot();
  return [
    { id: 'lifecycle-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleIndexReadinessBoard(snapshot) },
    { id: 'lifecycle-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

