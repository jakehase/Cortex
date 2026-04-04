import { buildCommerceNotebookSnapshot, createCommerceNotebookRouteSummary } from '../service-commerce-notebook.mjs';

export function createCommerceNotebookDashboardRoutes(basePath = '/commerce-notebook') {
  const snapshot = buildCommerceNotebookSnapshot();
  return [
    { id: 'commerce-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceNotebookRouteSummary(snapshot) },
    { id: 'commerce-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

