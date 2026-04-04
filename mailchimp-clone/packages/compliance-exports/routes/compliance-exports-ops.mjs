import { buildComplianceExportsSnapshot, createComplianceExportsChecklist } from '../service-compliance-exports.mjs';

export function createComplianceExportsOpsRoutes(basePath = '/ops/compliance-exports') {
  const snapshot = buildComplianceExportsSnapshot();
  return [
    { id: 'compliance-exports.ops.health', method: 'GET', path: basePath + '/health', checklist: createComplianceExportsChecklist(snapshot) },
    { id: 'compliance-exports.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'compliance-exports.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
