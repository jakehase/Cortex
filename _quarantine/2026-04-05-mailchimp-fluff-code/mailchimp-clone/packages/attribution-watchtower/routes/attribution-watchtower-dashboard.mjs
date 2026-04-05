import { buildAttributionWatchtowerSnapshot, createAttributionWatchtowerRouteSummary } from '../service-attribution-watchtower.mjs';

export function createAttributionWatchtowerDashboardRoutes(basePath = '/attribution-watchtower') {
  const snapshot = buildAttributionWatchtowerSnapshot();
  return [
    { id: 'attribution-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionWatchtowerRouteSummary(snapshot) },
    { id: 'attribution-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

