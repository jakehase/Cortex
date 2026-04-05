import { buildBillingHubSnapshot, createBillingHubRouteSummary } from '../service-billing-hub.mjs';

export function createBillingHubDashboardRoutes(basePath = '/billing-hub') {
  const snapshot = buildBillingHubSnapshot();
  return [
    { id: 'billing-hub.dashboard.overview', method: 'GET', path: basePath, summary: createBillingHubRouteSummary(snapshot) },
    { id: 'billing-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

