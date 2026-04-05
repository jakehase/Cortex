import { buildIntegrationsExchangeSnapshot, createIntegrationsExchangeRouteSummary } from '../service-integrations-exchange.mjs';

export function createIntegrationsExchangeDashboardRoutes(basePath = '/integrations-exchange') {
  const snapshot = buildIntegrationsExchangeSnapshot();
  return [
    { id: 'integrations-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsExchangeRouteSummary(snapshot) },
    { id: 'integrations-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

