import { buildCustomerVaultSnapshot, createCustomerVaultRouteSummary } from '../service-customer-vault.mjs';

export function createCustomerVaultDashboardRoutes(basePath = '/customer-vault') {
  const snapshot = buildCustomerVaultSnapshot();
  return [
    { id: 'customer-vault.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerVaultRouteSummary(snapshot) },
    { id: 'customer-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

