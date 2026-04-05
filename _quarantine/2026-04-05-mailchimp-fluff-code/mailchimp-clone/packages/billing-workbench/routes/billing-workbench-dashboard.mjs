import { buildBillingWorkbenchSnapshot, createBillingWorkbenchRouteSummary } from '../service-billing-workbench.mjs';

export function createBillingWorkbenchDashboardRoutes(basePath = '/billing-workbench') {
  const snapshot = buildBillingWorkbenchSnapshot();
  return [
    { id: 'billing-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createBillingWorkbenchRouteSummary(snapshot) },
    { id: 'billing-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

