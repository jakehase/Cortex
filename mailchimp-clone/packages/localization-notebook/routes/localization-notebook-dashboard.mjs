import { buildLocalizationNotebookSnapshot, createLocalizationNotebookRouteSummary } from '../service-localization-notebook.mjs';

export function createLocalizationNotebookDashboardRoutes(basePath = '/localization-notebook') {
  const snapshot = buildLocalizationNotebookSnapshot();
  return [
    { id: 'localization-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationNotebookRouteSummary(snapshot) },
    { id: 'localization-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

