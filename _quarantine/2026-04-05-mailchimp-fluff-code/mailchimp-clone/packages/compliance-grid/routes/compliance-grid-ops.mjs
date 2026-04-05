import { buildComplianceGridSnapshot, createComplianceGridReadinessBoard } from '../service-compliance-grid.mjs';

export function createComplianceGridOpsRoutes(basePath = '/ops/compliance-grid') {
  const snapshot = buildComplianceGridSnapshot();
  return [
    { id: 'compliance-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceGridReadinessBoard(snapshot) },
    { id: 'compliance-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

