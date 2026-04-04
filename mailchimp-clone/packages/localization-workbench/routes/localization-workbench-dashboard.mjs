import { buildLocalizationWorkbenchSnapshot, createLocalizationWorkbenchRouteSummary } from '../service-localization-workbench.mjs';

export function createLocalizationWorkbenchDashboardRoutes(basePath = '/localization-workbench') {
  const snapshot = buildLocalizationWorkbenchSnapshot();
  return [
    { id: 'localization-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationWorkbenchRouteSummary(snapshot) },
    { id: 'localization-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

