import { buildCreativeHubSnapshot, createCreativeHubRouteSummary } from '../service-creative-hub.mjs';

export function createCreativeHubDashboardRoutes(basePath = '/creative-hub') {
  const snapshot = buildCreativeHubSnapshot();
  return [
    { id: 'creative-hub.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeHubRouteSummary(snapshot) },
    { id: 'creative-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

