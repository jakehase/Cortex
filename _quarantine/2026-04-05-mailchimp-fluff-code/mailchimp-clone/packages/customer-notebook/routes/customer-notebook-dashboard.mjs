import { buildCustomerNotebookSnapshot, createCustomerNotebookRouteSummary } from '../service-customer-notebook.mjs';

export function createCustomerNotebookDashboardRoutes(basePath = '/customer-notebook') {
  const snapshot = buildCustomerNotebookSnapshot();
  return [
    { id: 'customer-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerNotebookRouteSummary(snapshot) },
    { id: 'customer-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

