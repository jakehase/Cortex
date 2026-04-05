import { buildLoyaltyNavigatorSnapshot, createLoyaltyNavigatorRouteSummary } from '../service-loyalty-navigator.mjs';

export function createLoyaltyNavigatorDashboardRoutes(basePath = '/loyalty-navigator') {
  const snapshot = buildLoyaltyNavigatorSnapshot();
  return [
    { id: 'loyalty-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyNavigatorRouteSummary(snapshot) },
    { id: 'loyalty-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

