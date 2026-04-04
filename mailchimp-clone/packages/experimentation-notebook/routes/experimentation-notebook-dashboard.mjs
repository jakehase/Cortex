import { buildExperimentationNotebookSnapshot, createExperimentationNotebookRouteSummary } from '../service-experimentation-notebook.mjs';

export function createExperimentationNotebookDashboardRoutes(basePath = '/experimentation-notebook') {
  const snapshot = buildExperimentationNotebookSnapshot();
  return [
    { id: 'experimentation-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationNotebookRouteSummary(snapshot) },
    { id: 'experimentation-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

