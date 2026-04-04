import { buildBillingWatchtowerSnapshot, createBillingWatchtowerRouteSummary } from '../service-billing-watchtower.mjs';

export function createBillingWatchtowerDashboardRoutes(basePath = '/billing-watchtower') {
  const snapshot = buildBillingWatchtowerSnapshot();
  return [
    { id: 'billing-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createBillingWatchtowerRouteSummary(snapshot) },
    { id: 'billing-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

