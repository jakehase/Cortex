import { buildAttributionNotebookSnapshot, createAttributionNotebookRouteSummary } from '../service-attribution-notebook.mjs';

export function createAttributionNotebookDashboardRoutes(basePath = '/attribution-notebook') {
  const snapshot = buildAttributionNotebookSnapshot();
  return [
    { id: 'attribution-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionNotebookRouteSummary(snapshot) },
    { id: 'attribution-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

