import { buildLocalizationIndexSnapshot, createLocalizationIndexRouteSummary } from '../service-localization-index.mjs';

export function createLocalizationIndexDashboardRoutes(basePath = '/localization-index') {
  const snapshot = buildLocalizationIndexSnapshot();
  return [
    { id: 'localization-index.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationIndexRouteSummary(snapshot) },
    { id: 'localization-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

