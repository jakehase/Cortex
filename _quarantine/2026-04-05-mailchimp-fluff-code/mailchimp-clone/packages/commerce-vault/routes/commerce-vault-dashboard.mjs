import { buildCommerceVaultSnapshot, createCommerceVaultRouteSummary } from '../service-commerce-vault.mjs';

export function createCommerceVaultDashboardRoutes(basePath = '/commerce-vault') {
  const snapshot = buildCommerceVaultSnapshot();
  return [
    { id: 'commerce-vault.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceVaultRouteSummary(snapshot) },
    { id: 'commerce-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

