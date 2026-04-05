import { buildLoyaltyWatchtowerSnapshot, createLoyaltyWatchtowerRouteSummary } from '../service-loyalty-watchtower.mjs';

export function createLoyaltyWatchtowerDashboardRoutes(basePath = '/loyalty-watchtower') {
  const snapshot = buildLoyaltyWatchtowerSnapshot();
  return [
    { id: 'loyalty-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyWatchtowerRouteSummary(snapshot) },
    { id: 'loyalty-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

