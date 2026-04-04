import { buildAdvocacyExchangeSnapshot, createAdvocacyExchangeRouteSummary } from '../service-advocacy-exchange.mjs';

export function createAdvocacyExchangeDashboardRoutes(basePath = '/advocacy-exchange') {
  const snapshot = buildAdvocacyExchangeSnapshot();
  return [
    { id: 'advocacy-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyExchangeRouteSummary(snapshot) },
    { id: 'advocacy-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

