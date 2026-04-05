import { buildAdvocacyNavigatorSnapshot, createAdvocacyNavigatorRouteSummary } from '../service-advocacy-navigator.mjs';

export function createAdvocacyNavigatorDashboardRoutes(basePath = '/advocacy-navigator') {
  const snapshot = buildAdvocacyNavigatorSnapshot();
  return [
    { id: 'advocacy-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyNavigatorRouteSummary(snapshot) },
    { id: 'advocacy-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

