import { buildLoyaltyIndexSnapshot, createLoyaltyIndexRouteSummary } from '../service-loyalty-index.mjs';

export function createLoyaltyIndexDashboardRoutes(basePath = '/loyalty-index') {
  const snapshot = buildLoyaltyIndexSnapshot();
  return [
    { id: 'loyalty-index.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyIndexRouteSummary(snapshot) },
    { id: 'loyalty-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

