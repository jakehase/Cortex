import { buildAnalyticsVaultSnapshot, createAnalyticsVaultReadinessBoard } from '../service-analytics-vault.mjs';

export function createAnalyticsVaultOpsRoutes(basePath = '/ops/analytics-vault') {
  const snapshot = buildAnalyticsVaultSnapshot();
  return [
    { id: 'analytics-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsVaultReadinessBoard(snapshot) },
    { id: 'analytics-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

