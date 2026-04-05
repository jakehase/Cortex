import { buildLoyaltyPlannerSnapshot, createLoyaltyPlannerReadinessBoard } from '../service-loyalty-planner.mjs';

export function createLoyaltyPlannerOpsRoutes(basePath = '/ops/loyalty-planner') {
  const snapshot = buildLoyaltyPlannerSnapshot();
  return [
    { id: 'loyalty-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyPlannerReadinessBoard(snapshot) },
    { id: 'loyalty-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

