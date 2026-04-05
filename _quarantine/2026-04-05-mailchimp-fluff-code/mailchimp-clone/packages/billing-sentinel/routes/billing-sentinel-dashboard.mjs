import { buildBillingSentinelSnapshot, createBillingSentinelRouteSummary } from '../service-billing-sentinel.mjs';

export function createBillingSentinelDashboardRoutes(basePath = '/billing-sentinel') {
  const snapshot = buildBillingSentinelSnapshot();
  return [
    { id: 'billing-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createBillingSentinelRouteSummary(snapshot) },
    { id: 'billing-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

