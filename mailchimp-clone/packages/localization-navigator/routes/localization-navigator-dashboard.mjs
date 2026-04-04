import { buildLocalizationNavigatorSnapshot, createLocalizationNavigatorRouteSummary } from '../service-localization-navigator.mjs';

export function createLocalizationNavigatorDashboardRoutes(basePath = '/localization-navigator') {
  const snapshot = buildLocalizationNavigatorSnapshot();
  return [
    { id: 'localization-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationNavigatorRouteSummary(snapshot) },
    { id: 'localization-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

