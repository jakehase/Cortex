import { buildLoyaltyStudioSnapshot, createLoyaltyStudioRouteSummary } from '../service-loyalty-studio.mjs';

export function createLoyaltyStudioDashboardRoutes(basePath = '/loyalty-studio') {
  const snapshot = buildLoyaltyStudioSnapshot();
  return [
    { id: 'loyalty-studio.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyStudioRouteSummary(snapshot) },
    { id: 'loyalty-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

