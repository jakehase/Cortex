import { buildAudienceVaultSnapshot, createAudienceVaultRouteSummary } from '../service-audience-vault.mjs';

export function createAudienceVaultDashboardRoutes(basePath = '/audience-vault') {
  const snapshot = buildAudienceVaultSnapshot();
  return [
    { id: 'audience-vault.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceVaultRouteSummary(snapshot) },
    { id: 'audience-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

