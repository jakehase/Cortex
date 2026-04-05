import { buildEcommerceWatchtowerSnapshot, createEcommerceWatchtowerRouteSummary } from '../service-ecommerce-watchtower.mjs';

export function createEcommerceWatchtowerDashboardRoutes(basePath = '/ecommerce-watchtower') {
  const snapshot = buildEcommerceWatchtowerSnapshot();
  return [
    { id: 'ecommerce-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceWatchtowerRouteSummary(snapshot) },
    { id: 'ecommerce-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

