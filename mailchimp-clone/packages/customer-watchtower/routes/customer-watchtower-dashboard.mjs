import { buildCustomerWatchtowerSnapshot, createCustomerWatchtowerRouteSummary } from '../service-customer-watchtower.mjs';

export function createCustomerWatchtowerDashboardRoutes(basePath = '/customer-watchtower') {
  const snapshot = buildCustomerWatchtowerSnapshot();
  return [
    { id: 'customer-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerWatchtowerRouteSummary(snapshot) },
    { id: 'customer-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

