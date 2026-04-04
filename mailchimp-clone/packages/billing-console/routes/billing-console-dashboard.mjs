import { buildBillingConsoleSnapshot, createBillingConsoleRouteSummary } from '../service-billing-console.mjs';

export function createBillingConsoleDashboardRoutes(basePath = '/billing-console') {
  const snapshot = buildBillingConsoleSnapshot();
  return [
    { id: 'billing-console.dashboard.overview', method: 'GET', path: basePath, summary: createBillingConsoleRouteSummary(snapshot) },
    { id: 'billing-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

