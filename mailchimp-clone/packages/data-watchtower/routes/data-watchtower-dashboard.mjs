import { buildDataWatchtowerSnapshot, createDataWatchtowerRouteSummary } from '../service-data-watchtower.mjs';

export function createDataWatchtowerDashboardRoutes(basePath = '/data-watchtower') {
  const snapshot = buildDataWatchtowerSnapshot();
  return [
    { id: 'data-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createDataWatchtowerRouteSummary(snapshot) },
    { id: 'data-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

