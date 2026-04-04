import { buildAdvocacyNotebookSnapshot, createAdvocacyNotebookRouteSummary } from '../service-advocacy-notebook.mjs';

export function createAdvocacyNotebookDashboardRoutes(basePath = '/advocacy-notebook') {
  const snapshot = buildAdvocacyNotebookSnapshot();
  return [
    { id: 'advocacy-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyNotebookRouteSummary(snapshot) },
    { id: 'advocacy-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

