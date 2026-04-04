import { buildCustomerSentinelSnapshot, createCustomerSentinelRouteSummary } from '../service-customer-sentinel.mjs';

export function createCustomerSentinelDashboardRoutes(basePath = '/customer-sentinel') {
  const snapshot = buildCustomerSentinelSnapshot();
  return [
    { id: 'customer-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerSentinelRouteSummary(snapshot) },
    { id: 'customer-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

