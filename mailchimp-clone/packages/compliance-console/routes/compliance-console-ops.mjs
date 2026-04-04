import { buildComplianceConsoleSnapshot, createComplianceConsoleReadinessBoard } from '../service-compliance-console.mjs';

export function createComplianceConsoleOpsRoutes(basePath = '/ops/compliance-console') {
  const snapshot = buildComplianceConsoleSnapshot();
  return [
    { id: 'compliance-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceConsoleReadinessBoard(snapshot) },
    { id: 'compliance-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

