import { buildCreativeNavigatorSnapshot, createCreativeNavigatorRouteSummary } from '../service-creative-navigator.mjs';

export function createCreativeNavigatorDashboardRoutes(basePath = '/creative-navigator') {
  const snapshot = buildCreativeNavigatorSnapshot();
  return [
    { id: 'creative-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeNavigatorRouteSummary(snapshot) },
    { id: 'creative-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

