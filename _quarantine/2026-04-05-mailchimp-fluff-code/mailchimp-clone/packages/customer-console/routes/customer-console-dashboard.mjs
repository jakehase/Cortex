import { buildCustomerConsoleSnapshot, createCustomerConsoleRouteSummary } from '../service-customer-console.mjs';

export function createCustomerConsoleDashboardRoutes(basePath = '/customer-console') {
  const snapshot = buildCustomerConsoleSnapshot();
  return [
    { id: 'customer-console.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerConsoleRouteSummary(snapshot) },
    { id: 'customer-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

