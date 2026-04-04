import { buildBillingAnalyticsSnapshot, createBillingAnalyticsChecklist } from '../service-billing-analytics.mjs';

export function createBillingAnalyticsOpsRoutes(basePath = '/ops/billing-analytics') {
  const snapshot = buildBillingAnalyticsSnapshot();
  return [
    { id: 'billing-analytics.ops.health', method: 'GET', path: basePath + '/health', checklist: createBillingAnalyticsChecklist(snapshot) },
    { id: 'billing-analytics.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'billing-analytics.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
