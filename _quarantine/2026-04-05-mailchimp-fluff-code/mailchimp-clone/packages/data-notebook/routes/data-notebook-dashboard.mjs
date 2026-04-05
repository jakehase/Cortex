import { buildDataNotebookSnapshot, createDataNotebookRouteSummary } from '../service-data-notebook.mjs';

export function createDataNotebookDashboardRoutes(basePath = '/data-notebook') {
  const snapshot = buildDataNotebookSnapshot();
  return [
    { id: 'data-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createDataNotebookRouteSummary(snapshot) },
    { id: 'data-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

