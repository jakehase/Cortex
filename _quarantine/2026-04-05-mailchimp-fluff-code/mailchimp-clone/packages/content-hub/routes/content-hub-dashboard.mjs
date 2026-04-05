import { buildContentHubSnapshot, createContentHubRouteSummary } from '../service-content-hub.mjs';

export function createContentHubDashboardRoutes(basePath = '/content-hub') {
  const snapshot = buildContentHubSnapshot();
  return [
    { id: 'content-hub.dashboard.overview', method: 'GET', path: basePath, summary: createContentHubRouteSummary(snapshot) },
    { id: 'content-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

