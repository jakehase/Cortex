import { buildLocalizationGridSnapshot, createLocalizationGridRouteSummary } from '../service-localization-grid.mjs';

export function createLocalizationGridDashboardRoutes(basePath = '/localization-grid') {
  const snapshot = buildLocalizationGridSnapshot();
  return [
    { id: 'localization-grid.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationGridRouteSummary(snapshot) },
    { id: 'localization-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

