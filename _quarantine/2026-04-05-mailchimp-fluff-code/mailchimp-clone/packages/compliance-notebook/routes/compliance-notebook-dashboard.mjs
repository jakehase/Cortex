import { buildComplianceNotebookSnapshot, createComplianceNotebookRouteSummary } from '../service-compliance-notebook.mjs';

export function createComplianceNotebookDashboardRoutes(basePath = '/compliance-notebook') {
  const snapshot = buildComplianceNotebookSnapshot();
  return [
    { id: 'compliance-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceNotebookRouteSummary(snapshot) },
    { id: 'compliance-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

