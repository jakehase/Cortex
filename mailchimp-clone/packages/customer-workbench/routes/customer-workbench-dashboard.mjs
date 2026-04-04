import { buildCustomerWorkbenchSnapshot, createCustomerWorkbenchRouteSummary } from '../service-customer-workbench.mjs';

export function createCustomerWorkbenchDashboardRoutes(basePath = '/customer-workbench') {
  const snapshot = buildCustomerWorkbenchSnapshot();
  return [
    { id: 'customer-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerWorkbenchRouteSummary(snapshot) },
    { id: 'customer-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

