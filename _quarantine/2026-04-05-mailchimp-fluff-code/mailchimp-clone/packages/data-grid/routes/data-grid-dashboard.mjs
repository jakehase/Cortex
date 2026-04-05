import { buildDataGridSnapshot, createDataGridRouteSummary } from '../service-data-grid.mjs';

export function createDataGridDashboardRoutes(basePath = '/data-grid') {
  const snapshot = buildDataGridSnapshot();
  return [
    { id: 'data-grid.dashboard.overview', method: 'GET', path: basePath, summary: createDataGridRouteSummary(snapshot) },
    { id: 'data-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

