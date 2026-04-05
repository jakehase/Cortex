import { buildContentPlannerSnapshot, createContentPlannerReadinessBoard } from '../service-content-planner.mjs';

export function createContentPlannerOpsRoutes(basePath = '/ops/content-planner') {
  const snapshot = buildContentPlannerSnapshot();
  return [
    { id: 'content-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentPlannerReadinessBoard(snapshot) },
    { id: 'content-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

