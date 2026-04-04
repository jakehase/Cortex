import { buildCreativeSentinelSnapshot, createCreativeSentinelRouteSummary } from '../service-creative-sentinel.mjs';

export function createCreativeSentinelDashboardRoutes(basePath = '/creative-sentinel') {
  const snapshot = buildCreativeSentinelSnapshot();
  return [
    { id: 'creative-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeSentinelRouteSummary(snapshot) },
    { id: 'creative-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

