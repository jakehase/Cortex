import { buildBrandGovernanceSnapshot, createBrandGovernanceChecklist } from '../service-brand-governance.mjs';

export function createBrandGovernanceOpsRoutes(basePath = '/ops/brand-governance') {
  const snapshot = buildBrandGovernanceSnapshot();
  return [
    { id: 'brand-governance.ops.health', method: 'GET', path: basePath + '/health', checklist: createBrandGovernanceChecklist(snapshot) },
    { id: 'brand-governance.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'brand-governance.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
