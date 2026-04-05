import { buildLoyaltySentinelSnapshot, createLoyaltySentinelRouteSummary } from '../service-loyalty-sentinel.mjs';

export function createLoyaltySentinelDashboardRoutes(basePath = '/loyalty-sentinel') {
  const snapshot = buildLoyaltySentinelSnapshot();
  return [
    { id: 'loyalty-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltySentinelRouteSummary(snapshot) },
    { id: 'loyalty-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

