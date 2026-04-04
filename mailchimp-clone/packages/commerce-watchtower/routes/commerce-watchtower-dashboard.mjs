import { buildCommerceWatchtowerSnapshot, createCommerceWatchtowerRouteSummary } from '../service-commerce-watchtower.mjs';

export function createCommerceWatchtowerDashboardRoutes(basePath = '/commerce-watchtower') {
  const snapshot = buildCommerceWatchtowerSnapshot();
  return [
    { id: 'commerce-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceWatchtowerRouteSummary(snapshot) },
    { id: 'commerce-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

