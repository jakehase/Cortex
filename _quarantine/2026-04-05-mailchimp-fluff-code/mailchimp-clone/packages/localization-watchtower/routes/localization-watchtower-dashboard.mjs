import { buildLocalizationWatchtowerSnapshot, createLocalizationWatchtowerRouteSummary } from '../service-localization-watchtower.mjs';

export function createLocalizationWatchtowerDashboardRoutes(basePath = '/localization-watchtower') {
  const snapshot = buildLocalizationWatchtowerSnapshot();
  return [
    { id: 'localization-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationWatchtowerRouteSummary(snapshot) },
    { id: 'localization-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

