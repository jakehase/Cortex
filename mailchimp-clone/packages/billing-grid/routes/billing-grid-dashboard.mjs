import { buildBillingGridSnapshot, createBillingGridRouteSummary } from '../service-billing-grid.mjs';

export function createBillingGridDashboardRoutes(basePath = '/billing-grid') {
  const snapshot = buildBillingGridSnapshot();
  return [
    { id: 'billing-grid.dashboard.overview', method: 'GET', path: basePath, summary: createBillingGridRouteSummary(snapshot) },
    { id: 'billing-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

