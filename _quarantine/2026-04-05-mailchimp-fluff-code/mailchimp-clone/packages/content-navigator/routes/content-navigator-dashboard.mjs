import { buildContentNavigatorSnapshot, createContentNavigatorRouteSummary } from '../service-content-navigator.mjs';

export function createContentNavigatorDashboardRoutes(basePath = '/content-navigator') {
  const snapshot = buildContentNavigatorSnapshot();
  return [
    { id: 'content-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createContentNavigatorRouteSummary(snapshot) },
    { id: 'content-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

