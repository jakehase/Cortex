import { buildBillingIndexSnapshot, createBillingIndexRouteSummary } from '../service-billing-index.mjs';

export function createBillingIndexDashboardRoutes(basePath = '/billing-index') {
  const snapshot = buildBillingIndexSnapshot();
  return [
    { id: 'billing-index.dashboard.overview', method: 'GET', path: basePath, summary: createBillingIndexRouteSummary(snapshot) },
    { id: 'billing-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

