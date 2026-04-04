import { buildBillingAnalyticsSnapshot } from '../service-billing-analytics.mjs';

export function createBillingAnalyticsDashboardRoutes(basePath = '/billing-analytics') {
  const snapshot = buildBillingAnalyticsSnapshot();
  return [
    { id: 'billing-analytics.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'billing-analytics.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-analytics.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
