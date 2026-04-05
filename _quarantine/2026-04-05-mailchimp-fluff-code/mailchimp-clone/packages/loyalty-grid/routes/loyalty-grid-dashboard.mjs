import { buildLoyaltyGridSnapshot, createLoyaltyGridRouteSummary } from '../service-loyalty-grid.mjs';

export function createLoyaltyGridDashboardRoutes(basePath = '/loyalty-grid') {
  const snapshot = buildLoyaltyGridSnapshot();
  return [
    { id: 'loyalty-grid.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyGridRouteSummary(snapshot) },
    { id: 'loyalty-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

