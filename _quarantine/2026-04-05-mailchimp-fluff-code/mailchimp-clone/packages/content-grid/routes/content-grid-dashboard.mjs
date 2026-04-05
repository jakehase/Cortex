import { buildContentGridSnapshot, createContentGridRouteSummary } from '../service-content-grid.mjs';

export function createContentGridDashboardRoutes(basePath = '/content-grid') {
  const snapshot = buildContentGridSnapshot();
  return [
    { id: 'content-grid.dashboard.overview', method: 'GET', path: basePath, summary: createContentGridRouteSummary(snapshot) },
    { id: 'content-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

