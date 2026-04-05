import { buildAudienceNotebookSnapshot, createAudienceNotebookRouteSummary } from '../service-audience-notebook.mjs';

export function createAudienceNotebookDashboardRoutes(basePath = '/audience-notebook') {
  const snapshot = buildAudienceNotebookSnapshot();
  return [
    { id: 'audience-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceNotebookRouteSummary(snapshot) },
    { id: 'audience-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

