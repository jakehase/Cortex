import { buildInsightsSentinelSnapshot, createInsightsSentinelRouteSummary } from '../service-insights-sentinel.mjs';

export function createInsightsSentinelDashboardRoutes(basePath = '/insights-sentinel') {
  const snapshot = buildInsightsSentinelSnapshot();
  return [
    { id: 'insights-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsSentinelRouteSummary(snapshot) },
    { id: 'insights-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

