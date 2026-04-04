import { buildBillingNavigatorSnapshot, createBillingNavigatorRouteSummary } from '../service-billing-navigator.mjs';

export function createBillingNavigatorDashboardRoutes(basePath = '/billing-navigator') {
  const snapshot = buildBillingNavigatorSnapshot();
  return [
    { id: 'billing-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createBillingNavigatorRouteSummary(snapshot) },
    { id: 'billing-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

