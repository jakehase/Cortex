import { buildCreativeGridSnapshot, createCreativeGridRouteSummary } from '../service-creative-grid.mjs';

export function createCreativeGridDashboardRoutes(basePath = '/creative-grid') {
  const snapshot = buildCreativeGridSnapshot();
  return [
    { id: 'creative-grid.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeGridRouteSummary(snapshot) },
    { id: 'creative-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

