import { buildEcommercePlannerSnapshot, createEcommercePlannerReadinessBoard } from '../service-ecommerce-planner.mjs';

export function createEcommercePlannerOpsRoutes(basePath = '/ops/ecommerce-planner') {
  const snapshot = buildEcommercePlannerSnapshot();
  return [
    { id: 'ecommerce-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommercePlannerReadinessBoard(snapshot) },
    { id: 'ecommerce-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

