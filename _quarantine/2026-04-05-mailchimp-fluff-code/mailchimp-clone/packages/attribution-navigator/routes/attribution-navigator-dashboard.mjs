import { buildAttributionNavigatorSnapshot, createAttributionNavigatorRouteSummary } from '../service-attribution-navigator.mjs';

export function createAttributionNavigatorDashboardRoutes(basePath = '/attribution-navigator') {
  const snapshot = buildAttributionNavigatorSnapshot();
  return [
    { id: 'attribution-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionNavigatorRouteSummary(snapshot) },
    { id: 'attribution-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

