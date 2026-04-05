import { buildAdvocacyVaultSnapshot, createAdvocacyVaultRouteSummary } from '../service-advocacy-vault.mjs';

export function createAdvocacyVaultDashboardRoutes(basePath = '/advocacy-vault') {
  const snapshot = buildAdvocacyVaultSnapshot();
  return [
    { id: 'advocacy-vault.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyVaultRouteSummary(snapshot) },
    { id: 'advocacy-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

