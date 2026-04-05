import { buildCreativeNotebookSnapshot, createCreativeNotebookRouteSummary } from '../service-creative-notebook.mjs';

export function createCreativeNotebookDashboardRoutes(basePath = '/creative-notebook') {
  const snapshot = buildCreativeNotebookSnapshot();
  return [
    { id: 'creative-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeNotebookRouteSummary(snapshot) },
    { id: 'creative-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

