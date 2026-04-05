import { buildCustomerGridSnapshot, createCustomerGridRouteSummary } from '../service-customer-grid.mjs';

export function createCustomerGridDashboardRoutes(basePath = '/customer-grid') {
  const snapshot = buildCustomerGridSnapshot();
  return [
    { id: 'customer-grid.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerGridRouteSummary(snapshot) },
    { id: 'customer-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

