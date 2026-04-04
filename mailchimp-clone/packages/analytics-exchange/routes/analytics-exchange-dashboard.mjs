import { buildAnalyticsExchangeSnapshot, createAnalyticsExchangeRouteSummary } from '../service-analytics-exchange.mjs';

export function createAnalyticsExchangeDashboardRoutes(basePath = '/analytics-exchange') {
  const snapshot = buildAnalyticsExchangeSnapshot();
  return [
    { id: 'analytics-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsExchangeRouteSummary(snapshot) },
    { id: 'analytics-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

