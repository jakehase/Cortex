import { buildLoyaltyExchangeSnapshot, createLoyaltyExchangeRouteSummary } from '../service-loyalty-exchange.mjs';

export function createLoyaltyExchangeDashboardRoutes(basePath = '/loyalty-exchange') {
  const snapshot = buildLoyaltyExchangeSnapshot();
  return [
    { id: 'loyalty-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyExchangeRouteSummary(snapshot) },
    { id: 'loyalty-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

