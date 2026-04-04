import { buildLifecycleSentinelSnapshot, createLifecycleSentinelRouteSummary } from '../service-lifecycle-sentinel.mjs';

export function createLifecycleSentinelDashboardRoutes(basePath = '/lifecycle-sentinel') {
  const snapshot = buildLifecycleSentinelSnapshot();
  return [
    { id: 'lifecycle-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleSentinelRouteSummary(snapshot) },
    { id: 'lifecycle-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

