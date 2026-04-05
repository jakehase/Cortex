import { buildCustomerStudioSnapshot, createCustomerStudioRouteSummary } from '../service-customer-studio.mjs';

export function createCustomerStudioDashboardRoutes(basePath = '/customer-studio') {
  const snapshot = buildCustomerStudioSnapshot();
  return [
    { id: 'customer-studio.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerStudioRouteSummary(snapshot) },
    { id: 'customer-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

