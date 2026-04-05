import { buildAnalyticsSentinelSnapshot, createAnalyticsSentinelRouteSummary } from '../service-analytics-sentinel.mjs';

export function createAnalyticsSentinelDashboardRoutes(basePath = '/analytics-sentinel') {
  const snapshot = buildAnalyticsSentinelSnapshot();
  return [
    { id: 'analytics-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsSentinelRouteSummary(snapshot) },
    { id: 'analytics-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

