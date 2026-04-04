import { buildCreativePlannerSnapshot, createCreativePlannerReadinessBoard } from '../service-creative-planner.mjs';

export function createCreativePlannerOpsRoutes(basePath = '/ops/creative-planner') {
  const snapshot = buildCreativePlannerSnapshot();
  return [
    { id: 'creative-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativePlannerReadinessBoard(snapshot) },
    { id: 'creative-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

