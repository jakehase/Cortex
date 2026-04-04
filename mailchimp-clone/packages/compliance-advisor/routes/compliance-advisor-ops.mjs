import { buildComplianceAdvisorSnapshot, createComplianceAdvisorReadinessBoard } from '../service-compliance-advisor.mjs';

export function createComplianceAdvisorOpsRoutes(basePath = '/ops/compliance-advisor') {
  const snapshot = buildComplianceAdvisorSnapshot();
  return [
    { id: 'compliance-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceAdvisorReadinessBoard(snapshot) },
    { id: 'compliance-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

