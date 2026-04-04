import { buildCollaborationNotebookSnapshot, createCollaborationNotebookRouteSummary } from '../service-collaboration-notebook.mjs';

export function createCollaborationNotebookDashboardRoutes(basePath = '/collaboration-notebook') {
  const snapshot = buildCollaborationNotebookSnapshot();
  return [
    { id: 'collaboration-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationNotebookRouteSummary(snapshot) },
    { id: 'collaboration-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

