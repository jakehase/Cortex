import { buildAttributionGridSnapshot, createAttributionGridRouteSummary } from '../service-attribution-grid.mjs';

export function createAttributionGridDashboardRoutes(basePath = '/attribution-grid') {
  const snapshot = buildAttributionGridSnapshot();
  return [
    { id: 'attribution-grid.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionGridRouteSummary(snapshot) },
    { id: 'attribution-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

