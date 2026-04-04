import { buildContentVaultSnapshot, createContentVaultRouteSummary } from '../service-content-vault.mjs';

export function createContentVaultDashboardRoutes(basePath = '/content-vault') {
  const snapshot = buildContentVaultSnapshot();
  return [
    { id: 'content-vault.dashboard.overview', method: 'GET', path: basePath, summary: createContentVaultRouteSummary(snapshot) },
    { id: 'content-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

