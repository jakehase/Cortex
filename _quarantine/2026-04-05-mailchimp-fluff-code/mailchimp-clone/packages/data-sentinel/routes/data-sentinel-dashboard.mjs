import { buildDataSentinelSnapshot, createDataSentinelRouteSummary } from '../service-data-sentinel.mjs';

export function createDataSentinelDashboardRoutes(basePath = '/data-sentinel') {
  const snapshot = buildDataSentinelSnapshot();
  return [
    { id: 'data-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createDataSentinelRouteSummary(snapshot) },
    { id: 'data-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

