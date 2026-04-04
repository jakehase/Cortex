import { buildContentIndexSnapshot, createContentIndexRouteSummary } from '../service-content-index.mjs';

export function createContentIndexDashboardRoutes(basePath = '/content-index') {
  const snapshot = buildContentIndexSnapshot();
  return [
    { id: 'content-index.dashboard.overview', method: 'GET', path: basePath, summary: createContentIndexRouteSummary(snapshot) },
    { id: 'content-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

