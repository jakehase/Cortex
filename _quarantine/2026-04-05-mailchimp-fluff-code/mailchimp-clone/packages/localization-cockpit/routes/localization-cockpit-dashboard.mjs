import { buildLocalizationCockpitSnapshot, createLocalizationCockpitRouteSummary } from '../service-localization-cockpit.mjs';

export function createLocalizationCockpitDashboardRoutes(basePath = '/localization-cockpit') {
  const snapshot = buildLocalizationCockpitSnapshot();
  return [
    { id: 'localization-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationCockpitRouteSummary(snapshot) },
    { id: 'localization-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

