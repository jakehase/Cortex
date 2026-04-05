import { buildAttributionStudioSnapshot, createAttributionStudioRouteSummary } from '../service-attribution-studio.mjs';

export function createAttributionStudioDashboardRoutes(basePath = '/attribution-studio') {
  const snapshot = buildAttributionStudioSnapshot();
  return [
    { id: 'attribution-studio.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionStudioRouteSummary(snapshot) },
    { id: 'attribution-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

