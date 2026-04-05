import { buildDataVaultSnapshot, createDataVaultRouteSummary } from '../service-data-vault.mjs';

export function createDataVaultDashboardRoutes(basePath = '/data-vault') {
  const snapshot = buildDataVaultSnapshot();
  return [
    { id: 'data-vault.dashboard.overview', method: 'GET', path: basePath, summary: createDataVaultRouteSummary(snapshot) },
    { id: 'data-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

