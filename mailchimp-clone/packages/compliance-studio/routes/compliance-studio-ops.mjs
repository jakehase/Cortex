import { buildComplianceStudioSnapshot, createComplianceStudioReadinessBoard } from '../service-compliance-studio.mjs';

export function createComplianceStudioOpsRoutes(basePath = '/ops/compliance-studio') {
  const snapshot = buildComplianceStudioSnapshot();
  return [
    { id: 'compliance-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceStudioReadinessBoard(snapshot) },
    { id: 'compliance-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

