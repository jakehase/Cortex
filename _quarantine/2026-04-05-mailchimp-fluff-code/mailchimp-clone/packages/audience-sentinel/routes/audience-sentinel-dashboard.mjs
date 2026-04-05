import { buildAudienceSentinelSnapshot, createAudienceSentinelRouteSummary } from '../service-audience-sentinel.mjs';

export function createAudienceSentinelDashboardRoutes(basePath = '/audience-sentinel') {
  const snapshot = buildAudienceSentinelSnapshot();
  return [
    { id: 'audience-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceSentinelRouteSummary(snapshot) },
    { id: 'audience-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

