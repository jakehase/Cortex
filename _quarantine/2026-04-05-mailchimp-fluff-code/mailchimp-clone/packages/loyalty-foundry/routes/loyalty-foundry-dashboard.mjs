import { buildLoyaltyFoundrySnapshot, createLoyaltyFoundryRouteSummary } from '../service-loyalty-foundry.mjs';

export function createLoyaltyFoundryDashboardRoutes(basePath = '/loyalty-foundry') {
  const snapshot = buildLoyaltyFoundrySnapshot();
  return [
    { id: 'loyalty-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyFoundryRouteSummary(snapshot) },
    { id: 'loyalty-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

