import { buildContentExchangeSnapshot, createContentExchangeRouteSummary } from '../service-content-exchange.mjs';

export function createContentExchangeDashboardRoutes(basePath = '/content-exchange') {
  const snapshot = buildContentExchangeSnapshot();
  return [
    { id: 'content-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createContentExchangeRouteSummary(snapshot) },
    { id: 'content-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

