import { buildLoyaltyVaultSnapshot, createLoyaltyVaultRouteSummary } from '../service-loyalty-vault.mjs';

export function createLoyaltyVaultDashboardRoutes(basePath = '/loyalty-vault') {
  const snapshot = buildLoyaltyVaultSnapshot();
  return [
    { id: 'loyalty-vault.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyVaultRouteSummary(snapshot) },
    { id: 'loyalty-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

