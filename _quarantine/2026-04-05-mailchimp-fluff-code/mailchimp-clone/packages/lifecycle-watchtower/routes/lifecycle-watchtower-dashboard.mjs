import { buildLifecycleWatchtowerSnapshot, createLifecycleWatchtowerRouteSummary } from '../service-lifecycle-watchtower.mjs';

export function createLifecycleWatchtowerDashboardRoutes(basePath = '/lifecycle-watchtower') {
  const snapshot = buildLifecycleWatchtowerSnapshot();
  return [
    { id: 'lifecycle-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleWatchtowerRouteSummary(snapshot) },
    { id: 'lifecycle-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

