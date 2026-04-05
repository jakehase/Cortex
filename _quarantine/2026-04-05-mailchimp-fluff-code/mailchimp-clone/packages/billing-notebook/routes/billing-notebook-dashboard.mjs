import { buildBillingNotebookSnapshot, createBillingNotebookRouteSummary } from '../service-billing-notebook.mjs';

export function createBillingNotebookDashboardRoutes(basePath = '/billing-notebook') {
  const snapshot = buildBillingNotebookSnapshot();
  return [
    { id: 'billing-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createBillingNotebookRouteSummary(snapshot) },
    { id: 'billing-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

