import { buildContentSentinelSnapshot, createContentSentinelRouteSummary } from '../service-content-sentinel.mjs';

export function createContentSentinelDashboardRoutes(basePath = '/content-sentinel') {
  const snapshot = buildContentSentinelSnapshot();
  return [
    { id: 'content-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createContentSentinelRouteSummary(snapshot) },
    { id: 'content-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

