import { buildLocalizationFoundrySnapshot, createLocalizationFoundryRouteSummary } from '../service-localization-foundry.mjs';

export function createLocalizationFoundryDashboardRoutes(basePath = '/localization-foundry') {
  const snapshot = buildLocalizationFoundrySnapshot();
  return [
    { id: 'localization-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationFoundryRouteSummary(snapshot) },
    { id: 'localization-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

