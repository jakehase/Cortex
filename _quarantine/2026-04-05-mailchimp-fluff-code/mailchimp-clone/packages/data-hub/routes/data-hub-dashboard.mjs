import { buildDataHubSnapshot, createDataHubRouteSummary } from '../service-data-hub.mjs';

export function createDataHubDashboardRoutes(basePath = '/data-hub') {
  const snapshot = buildDataHubSnapshot();
  return [
    { id: 'data-hub.dashboard.overview', method: 'GET', path: basePath, summary: createDataHubRouteSummary(snapshot) },
    { id: 'data-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

