import { buildCreativeWatchtowerSnapshot, createCreativeWatchtowerRouteSummary } from '../service-creative-watchtower.mjs';

export function createCreativeWatchtowerDashboardRoutes(basePath = '/creative-watchtower') {
  const snapshot = buildCreativeWatchtowerSnapshot();
  return [
    { id: 'creative-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeWatchtowerRouteSummary(snapshot) },
    { id: 'creative-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

