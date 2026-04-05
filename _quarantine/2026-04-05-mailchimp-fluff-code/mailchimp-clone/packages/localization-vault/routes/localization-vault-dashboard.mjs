import { buildLocalizationVaultSnapshot, createLocalizationVaultRouteSummary } from '../service-localization-vault.mjs';

export function createLocalizationVaultDashboardRoutes(basePath = '/localization-vault') {
  const snapshot = buildLocalizationVaultSnapshot();
  return [
    { id: 'localization-vault.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationVaultRouteSummary(snapshot) },
    { id: 'localization-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

