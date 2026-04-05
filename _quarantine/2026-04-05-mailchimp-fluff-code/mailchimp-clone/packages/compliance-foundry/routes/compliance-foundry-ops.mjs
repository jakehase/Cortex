import { buildComplianceFoundrySnapshot, createComplianceFoundryReadinessBoard } from '../service-compliance-foundry.mjs';

export function createComplianceFoundryOpsRoutes(basePath = '/ops/compliance-foundry') {
  const snapshot = buildComplianceFoundrySnapshot();
  return [
    { id: 'compliance-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceFoundryReadinessBoard(snapshot) },
    { id: 'compliance-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

