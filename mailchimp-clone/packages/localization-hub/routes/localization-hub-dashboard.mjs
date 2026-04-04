import { buildLocalizationHubSnapshot, createLocalizationHubRouteSummary } from '../service-localization-hub.mjs';

export function createLocalizationHubDashboardRoutes(basePath = '/localization-hub') {
  const snapshot = buildLocalizationHubSnapshot();
  return [
    { id: 'localization-hub.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationHubRouteSummary(snapshot) },
    { id: 'localization-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

