import { buildActivationNotebookSnapshot, createActivationNotebookRouteSummary } from '../service-activation-notebook.mjs';

export function createActivationNotebookDashboardRoutes(basePath = '/activation-notebook') {
  const snapshot = buildActivationNotebookSnapshot();
  return [
    { id: 'activation-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createActivationNotebookRouteSummary(snapshot) },
    { id: 'activation-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

