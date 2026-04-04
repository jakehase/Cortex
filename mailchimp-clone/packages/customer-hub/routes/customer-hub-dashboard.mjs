import { buildCustomerHubSnapshot, createCustomerHubRouteSummary } from '../service-customer-hub.mjs';

export function createCustomerHubDashboardRoutes(basePath = '/customer-hub') {
  const snapshot = buildCustomerHubSnapshot();
  return [
    { id: 'customer-hub.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerHubRouteSummary(snapshot) },
    { id: 'customer-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

