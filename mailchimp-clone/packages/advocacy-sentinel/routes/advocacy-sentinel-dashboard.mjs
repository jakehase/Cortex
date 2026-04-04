import { buildAdvocacySentinelSnapshot, createAdvocacySentinelRouteSummary } from '../service-advocacy-sentinel.mjs';

export function createAdvocacySentinelDashboardRoutes(basePath = '/advocacy-sentinel') {
  const snapshot = buildAdvocacySentinelSnapshot();
  return [
    { id: 'advocacy-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacySentinelRouteSummary(snapshot) },
    { id: 'advocacy-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

