import { buildCommerceSentinelSnapshot, createCommerceSentinelRouteSummary } from '../service-commerce-sentinel.mjs';

export function createCommerceSentinelDashboardRoutes(basePath = '/commerce-sentinel') {
  const snapshot = buildCommerceSentinelSnapshot();
  return [
    { id: 'commerce-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceSentinelRouteSummary(snapshot) },
    { id: 'commerce-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

