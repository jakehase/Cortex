import { buildAudienceHubSnapshot, createAudienceHubRouteSummary } from '../service-audience-hub.mjs';

export function createAudienceHubDashboardRoutes(basePath = '/audience-hub') {
  const snapshot = buildAudienceHubSnapshot();
  return [
    { id: 'audience-hub.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceHubRouteSummary(snapshot) },
    { id: 'audience-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

