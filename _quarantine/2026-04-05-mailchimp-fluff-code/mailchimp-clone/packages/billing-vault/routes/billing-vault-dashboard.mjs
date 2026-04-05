import { buildBillingVaultSnapshot, createBillingVaultRouteSummary } from '../service-billing-vault.mjs';

export function createBillingVaultDashboardRoutes(basePath = '/billing-vault') {
  const snapshot = buildBillingVaultSnapshot();
  return [
    { id: 'billing-vault.dashboard.overview', method: 'GET', path: basePath, summary: createBillingVaultRouteSummary(snapshot) },
    { id: 'billing-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

