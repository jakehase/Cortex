import { buildAttributionPlannerSnapshot, createAttributionPlannerReadinessBoard } from '../service-attribution-planner.mjs';

export function createAttributionPlannerOpsRoutes(basePath = '/ops/attribution-planner') {
  const snapshot = buildAttributionPlannerSnapshot();
  return [
    { id: 'attribution-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionPlannerReadinessBoard(snapshot) },
    { id: 'attribution-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

