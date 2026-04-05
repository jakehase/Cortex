import { buildAttributionSentinelSnapshot, createAttributionSentinelRouteSummary } from '../service-attribution-sentinel.mjs';

export function createAttributionSentinelDashboardRoutes(basePath = '/attribution-sentinel') {
  const snapshot = buildAttributionSentinelSnapshot();
  return [
    { id: 'attribution-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionSentinelRouteSummary(snapshot) },
    { id: 'attribution-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

