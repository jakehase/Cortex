import { buildAnalyticsFoundrySnapshot, createAnalyticsFoundryReadinessBoard } from '../service-analytics-foundry.mjs';

export function createAnalyticsFoundryOpsRoutes(basePath = '/ops/analytics-foundry') {
  const snapshot = buildAnalyticsFoundrySnapshot();
  return [
    { id: 'analytics-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsFoundryReadinessBoard(snapshot) },
    { id: 'analytics-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

