import { buildAdvocacyPlannerSnapshot, createAdvocacyPlannerReadinessBoard } from '../service-advocacy-planner.mjs';

export function createAdvocacyPlannerOpsRoutes(basePath = '/ops/advocacy-planner') {
  const snapshot = buildAdvocacyPlannerSnapshot();
  return [
    { id: 'advocacy-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyPlannerReadinessBoard(snapshot) },
    { id: 'advocacy-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

