import { buildLifecycleNavigatorSnapshot, createLifecycleNavigatorReadinessBoard } from '../service-lifecycle-navigator.mjs';

export function createLifecycleNavigatorOpsRoutes(basePath = '/ops/lifecycle-navigator') {
  const snapshot = buildLifecycleNavigatorSnapshot();
  return [
    { id: 'lifecycle-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleNavigatorReadinessBoard(snapshot) },
    { id: 'lifecycle-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

