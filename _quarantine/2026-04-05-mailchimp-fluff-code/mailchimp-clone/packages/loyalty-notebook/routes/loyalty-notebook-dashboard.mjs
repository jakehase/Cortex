import { buildLoyaltyNotebookSnapshot, createLoyaltyNotebookRouteSummary } from '../service-loyalty-notebook.mjs';

export function createLoyaltyNotebookDashboardRoutes(basePath = '/loyalty-notebook') {
  const snapshot = buildLoyaltyNotebookSnapshot();
  return [
    { id: 'loyalty-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyNotebookRouteSummary(snapshot) },
    { id: 'loyalty-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

