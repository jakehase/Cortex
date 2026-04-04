import { buildAutomationNotebookSnapshot, createAutomationNotebookRouteSummary } from '../service-automation-notebook.mjs';

export function createAutomationNotebookDashboardRoutes(basePath = '/automation-notebook') {
  const snapshot = buildAutomationNotebookSnapshot();
  return [
    { id: 'automation-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationNotebookRouteSummary(snapshot) },
    { id: 'automation-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

