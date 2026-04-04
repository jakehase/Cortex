import { buildAttributionExchangeSnapshot, createAttributionExchangeRouteSummary } from '../service-attribution-exchange.mjs';

export function createAttributionExchangeDashboardRoutes(basePath = '/attribution-exchange') {
  const snapshot = buildAttributionExchangeSnapshot();
  return [
    { id: 'attribution-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionExchangeRouteSummary(snapshot) },
    { id: 'attribution-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

