import { buildActivationExchangeSnapshot, createActivationExchangeRouteSummary } from '../service-activation-exchange.mjs';

export function createActivationExchangeDashboardRoutes(basePath = '/activation-exchange') {
  const snapshot = buildActivationExchangeSnapshot();
  return [
    { id: 'activation-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createActivationExchangeRouteSummary(snapshot) },
    { id: 'activation-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

