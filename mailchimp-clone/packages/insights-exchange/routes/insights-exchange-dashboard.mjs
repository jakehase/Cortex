import { buildInsightsExchangeSnapshot, createInsightsExchangeRouteSummary } from '../service-insights-exchange.mjs';

export function createInsightsExchangeDashboardRoutes(basePath = '/insights-exchange') {
  const snapshot = buildInsightsExchangeSnapshot();
  return [
    { id: 'insights-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsExchangeRouteSummary(snapshot) },
    { id: 'insights-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

