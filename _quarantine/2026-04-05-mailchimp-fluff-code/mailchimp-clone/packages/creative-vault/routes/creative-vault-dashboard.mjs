import { buildCreativeVaultSnapshot, createCreativeVaultRouteSummary } from '../service-creative-vault.mjs';

export function createCreativeVaultDashboardRoutes(basePath = '/creative-vault') {
  const snapshot = buildCreativeVaultSnapshot();
  return [
    { id: 'creative-vault.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeVaultRouteSummary(snapshot) },
    { id: 'creative-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

