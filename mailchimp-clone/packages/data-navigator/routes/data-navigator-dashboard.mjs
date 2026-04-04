import { buildDataNavigatorSnapshot, createDataNavigatorRouteSummary } from '../service-data-navigator.mjs';

export function createDataNavigatorDashboardRoutes(basePath = '/data-navigator') {
  const snapshot = buildDataNavigatorSnapshot();
  return [
    { id: 'data-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createDataNavigatorRouteSummary(snapshot) },
    { id: 'data-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

