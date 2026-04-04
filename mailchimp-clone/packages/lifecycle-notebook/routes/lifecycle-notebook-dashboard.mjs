import { buildLifecycleNotebookSnapshot, createLifecycleNotebookRouteSummary } from '../service-lifecycle-notebook.mjs';

export function createLifecycleNotebookDashboardRoutes(basePath = '/lifecycle-notebook') {
  const snapshot = buildLifecycleNotebookSnapshot();
  return [
    { id: 'lifecycle-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleNotebookRouteSummary(snapshot) },
    { id: 'lifecycle-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

