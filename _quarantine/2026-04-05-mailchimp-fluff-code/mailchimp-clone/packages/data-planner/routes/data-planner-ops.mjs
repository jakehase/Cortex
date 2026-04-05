import { buildDataPlannerSnapshot, createDataPlannerReadinessBoard } from '../service-data-planner.mjs';

export function createDataPlannerOpsRoutes(basePath = '/ops/data-planner') {
  const snapshot = buildDataPlannerSnapshot();
  return [
    { id: 'data-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataPlannerReadinessBoard(snapshot) },
    { id: 'data-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

