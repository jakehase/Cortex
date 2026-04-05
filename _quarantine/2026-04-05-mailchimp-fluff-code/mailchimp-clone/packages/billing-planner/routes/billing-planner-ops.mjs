import { buildBillingPlannerSnapshot, createBillingPlannerReadinessBoard } from '../service-billing-planner.mjs';

export function createBillingPlannerOpsRoutes(basePath = '/ops/billing-planner') {
  const snapshot = buildBillingPlannerSnapshot();
  return [
    { id: 'billing-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingPlannerReadinessBoard(snapshot) },
    { id: 'billing-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

