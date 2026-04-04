import { buildCreativeExchangeSnapshot, createCreativeExchangeRouteSummary } from '../service-creative-exchange.mjs';

export function createCreativeExchangeDashboardRoutes(basePath = '/creative-exchange') {
  const snapshot = buildCreativeExchangeSnapshot();
  return [
    { id: 'creative-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeExchangeRouteSummary(snapshot) },
    { id: 'creative-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

