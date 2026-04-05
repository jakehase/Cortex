import { buildInsightsVaultSnapshot, createInsightsVaultReadinessBoard } from '../service-insights-vault.mjs';

export function createInsightsVaultOpsRoutes(basePath = '/ops/insights-vault') {
  const snapshot = buildInsightsVaultSnapshot();
  return [
    { id: 'insights-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsVaultReadinessBoard(snapshot) },
    { id: 'insights-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

