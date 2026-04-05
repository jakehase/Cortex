import { buildAttributionHubSnapshot, createAttributionHubRouteSummary } from '../service-attribution-hub.mjs';

export function createAttributionHubDashboardRoutes(basePath = '/attribution-hub') {
  const snapshot = buildAttributionHubSnapshot();
  return [
    { id: 'attribution-hub.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionHubRouteSummary(snapshot) },
    { id: 'attribution-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

