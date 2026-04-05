import { buildCustomerPlannerSnapshot, createCustomerPlannerReadinessBoard } from '../service-customer-planner.mjs';

export function createCustomerPlannerOpsRoutes(basePath = '/ops/customer-planner') {
  const snapshot = buildCustomerPlannerSnapshot();
  return [
    { id: 'customer-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerPlannerReadinessBoard(snapshot) },
    { id: 'customer-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

