import { buildCustomerNavigatorSnapshot, createCustomerNavigatorRouteSummary } from '../service-customer-navigator.mjs';

export function createCustomerNavigatorDashboardRoutes(basePath = '/customer-navigator') {
  const snapshot = buildCustomerNavigatorSnapshot();
  return [
    { id: 'customer-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerNavigatorRouteSummary(snapshot) },
    { id: 'customer-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

