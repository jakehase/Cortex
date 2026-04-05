import { buildIntegrationsNotebookSnapshot, createIntegrationsNotebookRouteSummary } from '../service-integrations-notebook.mjs';

export function createIntegrationsNotebookDashboardRoutes(basePath = '/integrations-notebook') {
  const snapshot = buildIntegrationsNotebookSnapshot();
  return [
    { id: 'integrations-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsNotebookRouteSummary(snapshot) },
    { id: 'integrations-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

