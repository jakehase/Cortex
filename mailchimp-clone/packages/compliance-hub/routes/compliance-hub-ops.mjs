import { buildComplianceHubSnapshot, createComplianceHubReadinessBoard } from '../service-compliance-hub.mjs';

export function createComplianceHubOpsRoutes(basePath = '/ops/compliance-hub') {
  const snapshot = buildComplianceHubSnapshot();
  return [
    { id: 'compliance-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceHubReadinessBoard(snapshot) },
    { id: 'compliance-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

