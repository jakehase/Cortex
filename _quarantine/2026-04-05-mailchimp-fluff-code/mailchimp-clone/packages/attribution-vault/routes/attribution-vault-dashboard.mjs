import { buildAttributionVaultSnapshot, createAttributionVaultRouteSummary } from '../service-attribution-vault.mjs';

export function createAttributionVaultDashboardRoutes(basePath = '/attribution-vault') {
  const snapshot = buildAttributionVaultSnapshot();
  return [
    { id: 'attribution-vault.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionVaultRouteSummary(snapshot) },
    { id: 'attribution-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

