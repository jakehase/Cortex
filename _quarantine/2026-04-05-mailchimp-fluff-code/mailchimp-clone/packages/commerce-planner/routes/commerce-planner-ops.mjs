import { buildCommercePlannerSnapshot, createCommercePlannerReadinessBoard } from '../service-commerce-planner.mjs';

export function createCommercePlannerOpsRoutes(basePath = '/ops/commerce-planner') {
  const snapshot = buildCommercePlannerSnapshot();
  return [
    { id: 'commerce-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommercePlannerReadinessBoard(snapshot) },
    { id: 'commerce-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

