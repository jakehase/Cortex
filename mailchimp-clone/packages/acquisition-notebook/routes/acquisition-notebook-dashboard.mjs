import { buildAcquisitionNotebookSnapshot, createAcquisitionNotebookRouteSummary } from '../service-acquisition-notebook.mjs';

export function createAcquisitionNotebookDashboardRoutes(basePath = '/acquisition-notebook') {
  const snapshot = buildAcquisitionNotebookSnapshot();
  return [
    { id: 'acquisition-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionNotebookRouteSummary(snapshot) },
    { id: 'acquisition-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

