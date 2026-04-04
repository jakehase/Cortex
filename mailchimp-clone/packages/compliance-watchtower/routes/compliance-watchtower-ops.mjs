import { buildComplianceWatchtowerSnapshot, createComplianceWatchtowerReadinessBoard } from '../service-compliance-watchtower.mjs';

export function createComplianceWatchtowerOpsRoutes(basePath = '/ops/compliance-watchtower') {
  const snapshot = buildComplianceWatchtowerSnapshot();
  return [
    { id: 'compliance-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceWatchtowerReadinessBoard(snapshot) },
    { id: 'compliance-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

