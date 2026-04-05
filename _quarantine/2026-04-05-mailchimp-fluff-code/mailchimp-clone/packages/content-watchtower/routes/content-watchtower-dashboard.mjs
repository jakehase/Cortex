import { buildContentWatchtowerSnapshot, createContentWatchtowerRouteSummary } from '../service-content-watchtower.mjs';

export function createContentWatchtowerDashboardRoutes(basePath = '/content-watchtower') {
  const snapshot = buildContentWatchtowerSnapshot();
  return [
    { id: 'content-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createContentWatchtowerRouteSummary(snapshot) },
    { id: 'content-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

