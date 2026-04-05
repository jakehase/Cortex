import { buildAdvocacyWatchtowerSnapshot, createAdvocacyWatchtowerRouteSummary } from '../service-advocacy-watchtower.mjs';

export function createAdvocacyWatchtowerDashboardRoutes(basePath = '/advocacy-watchtower') {
  const snapshot = buildAdvocacyWatchtowerSnapshot();
  return [
    { id: 'advocacy-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyWatchtowerRouteSummary(snapshot) },
    { id: 'advocacy-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

