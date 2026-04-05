import { buildAudienceWatchtowerSnapshot, createAudienceWatchtowerRouteSummary } from '../service-audience-watchtower.mjs';

export function createAudienceWatchtowerDashboardRoutes(basePath = '/audience-watchtower') {
  const snapshot = buildAudienceWatchtowerSnapshot();
  return [
    { id: 'audience-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceWatchtowerRouteSummary(snapshot) },
    { id: 'audience-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

