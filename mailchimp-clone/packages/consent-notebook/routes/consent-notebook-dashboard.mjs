import { buildConsentNotebookSnapshot, createConsentNotebookRouteSummary } from '../service-consent-notebook.mjs';

export function createConsentNotebookDashboardRoutes(basePath = '/consent-notebook') {
  const snapshot = buildConsentNotebookSnapshot();
  return [
    { id: 'consent-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createConsentNotebookRouteSummary(snapshot) },
    { id: 'consent-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

