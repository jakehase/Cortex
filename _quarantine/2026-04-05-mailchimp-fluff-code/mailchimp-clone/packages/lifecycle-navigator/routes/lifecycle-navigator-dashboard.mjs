import { buildLifecycleNavigatorSnapshot, createLifecycleNavigatorRouteSummary } from '../service-lifecycle-navigator.mjs';

export function createLifecycleNavigatorDashboardRoutes(basePath = '/lifecycle-navigator') {
  const snapshot = buildLifecycleNavigatorSnapshot();
  return [
    { id: 'lifecycle-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleNavigatorRouteSummary(snapshot) },
    { id: 'lifecycle-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

