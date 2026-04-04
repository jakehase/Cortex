import { buildEcommerceNotebookSnapshot, createEcommerceNotebookRouteSummary } from '../service-ecommerce-notebook.mjs';

export function createEcommerceNotebookDashboardRoutes(basePath = '/ecommerce-notebook') {
  const snapshot = buildEcommerceNotebookSnapshot();
  return [
    { id: 'ecommerce-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceNotebookRouteSummary(snapshot) },
    { id: 'ecommerce-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

