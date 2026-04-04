import { buildLifecycleStudioSnapshot, createLifecycleStudioReadinessBoard } from '../service-lifecycle-studio.mjs';

export function createLifecycleStudioOpsRoutes(basePath = '/ops/lifecycle-studio') {
  const snapshot = buildLifecycleStudioSnapshot();
  return [
    { id: 'lifecycle-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleStudioReadinessBoard(snapshot) },
    { id: 'lifecycle-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

