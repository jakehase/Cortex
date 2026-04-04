import { buildLifecyclePlannerSnapshot, createLifecyclePlannerReadinessBoard } from '../service-lifecycle-planner.mjs';

export function createLifecyclePlannerOpsRoutes(basePath = '/ops/lifecycle-planner') {
  const snapshot = buildLifecyclePlannerSnapshot();
  return [
    { id: 'lifecycle-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecyclePlannerReadinessBoard(snapshot) },
    { id: 'lifecycle-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

