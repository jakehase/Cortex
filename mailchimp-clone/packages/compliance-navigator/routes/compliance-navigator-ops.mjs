import { buildComplianceNavigatorSnapshot, createComplianceNavigatorReadinessBoard } from '../service-compliance-navigator.mjs';

export function createComplianceNavigatorOpsRoutes(basePath = '/ops/compliance-navigator') {
  const snapshot = buildComplianceNavigatorSnapshot();
  return [
    { id: 'compliance-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceNavigatorReadinessBoard(snapshot) },
    { id: 'compliance-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

