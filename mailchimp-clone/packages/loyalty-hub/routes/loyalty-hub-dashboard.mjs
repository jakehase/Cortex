import { buildLoyaltyHubSnapshot, createLoyaltyHubRouteSummary } from '../service-loyalty-hub.mjs';

export function createLoyaltyHubDashboardRoutes(basePath = '/loyalty-hub') {
  const snapshot = buildLoyaltyHubSnapshot();
  return [
    { id: 'loyalty-hub.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyHubRouteSummary(snapshot) },
    { id: 'loyalty-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

