import { buildDataExchangeSnapshot, createDataExchangeRouteSummary } from '../service-data-exchange.mjs';

export function createDataExchangeDashboardRoutes(basePath = '/data-exchange') {
  const snapshot = buildDataExchangeSnapshot();
  return [
    { id: 'data-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createDataExchangeRouteSummary(snapshot) },
    { id: 'data-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

