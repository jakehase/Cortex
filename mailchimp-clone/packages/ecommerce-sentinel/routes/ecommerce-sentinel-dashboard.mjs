import { buildEcommerceSentinelSnapshot, createEcommerceSentinelRouteSummary } from '../service-ecommerce-sentinel.mjs';

export function createEcommerceSentinelDashboardRoutes(basePath = '/ecommerce-sentinel') {
  const snapshot = buildEcommerceSentinelSnapshot();
  return [
    { id: 'ecommerce-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceSentinelRouteSummary(snapshot) },
    { id: 'ecommerce-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

