import { buildComplianceWorkbenchSnapshot, createComplianceWorkbenchReadinessBoard } from '../service-compliance-workbench.mjs';

export function createComplianceWorkbenchOpsRoutes(basePath = '/ops/compliance-workbench') {
  const snapshot = buildComplianceWorkbenchSnapshot();
  return [
    { id: 'compliance-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceWorkbenchReadinessBoard(snapshot) },
    { id: 'compliance-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

