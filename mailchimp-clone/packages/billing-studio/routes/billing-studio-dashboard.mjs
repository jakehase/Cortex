import { buildBillingStudioSnapshot, createBillingStudioRouteSummary } from '../service-billing-studio.mjs';

export function createBillingStudioDashboardRoutes(basePath = '/billing-studio') {
  const snapshot = buildBillingStudioSnapshot();
  return [
    { id: 'billing-studio.dashboard.overview', method: 'GET', path: basePath, summary: createBillingStudioRouteSummary(snapshot) },
    { id: 'billing-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

