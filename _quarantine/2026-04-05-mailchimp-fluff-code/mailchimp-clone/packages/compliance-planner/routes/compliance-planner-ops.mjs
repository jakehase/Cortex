import { buildCompliancePlannerSnapshot, createCompliancePlannerReadinessBoard } from '../service-compliance-planner.mjs';

export function createCompliancePlannerOpsRoutes(basePath = '/ops/compliance-planner') {
  const snapshot = buildCompliancePlannerSnapshot();
  return [
    { id: 'compliance-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCompliancePlannerReadinessBoard(snapshot) },
    { id: 'compliance-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

