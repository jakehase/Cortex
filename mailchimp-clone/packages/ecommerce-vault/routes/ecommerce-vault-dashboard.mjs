import { buildEcommerceVaultSnapshot, createEcommerceVaultRouteSummary } from '../service-ecommerce-vault.mjs';

export function createEcommerceVaultDashboardRoutes(basePath = '/ecommerce-vault') {
  const snapshot = buildEcommerceVaultSnapshot();
  return [
    { id: 'ecommerce-vault.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceVaultRouteSummary(snapshot) },
    { id: 'ecommerce-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

