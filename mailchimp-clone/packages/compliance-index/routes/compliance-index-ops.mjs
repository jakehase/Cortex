import { buildComplianceIndexSnapshot, createComplianceIndexReadinessBoard } from '../service-compliance-index.mjs';

export function createComplianceIndexOpsRoutes(basePath = '/ops/compliance-index') {
  const snapshot = buildComplianceIndexSnapshot();
  return [
    { id: 'compliance-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceIndexReadinessBoard(snapshot) },
    { id: 'compliance-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

