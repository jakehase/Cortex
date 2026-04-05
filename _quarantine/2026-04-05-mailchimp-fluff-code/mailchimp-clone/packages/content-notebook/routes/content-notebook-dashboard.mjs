import { buildContentNotebookSnapshot, createContentNotebookRouteSummary } from '../service-content-notebook.mjs';

export function createContentNotebookDashboardRoutes(basePath = '/content-notebook') {
  const snapshot = buildContentNotebookSnapshot();
  return [
    { id: 'content-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createContentNotebookRouteSummary(snapshot) },
    { id: 'content-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

