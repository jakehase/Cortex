import { buildCustomerIndexSnapshot, createCustomerIndexRouteSummary } from '../service-customer-index.mjs';

export function createCustomerIndexDashboardRoutes(basePath = '/customer-index') {
  const snapshot = buildCustomerIndexSnapshot();
  return [
    { id: 'customer-index.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerIndexRouteSummary(snapshot) },
    { id: 'customer-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

