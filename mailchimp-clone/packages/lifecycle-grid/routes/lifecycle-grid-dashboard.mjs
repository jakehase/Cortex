import { buildLifecycleGridSnapshot, createLifecycleGridRouteSummary } from '../service-lifecycle-grid.mjs';

export function createLifecycleGridDashboardRoutes(basePath = '/lifecycle-grid') {
  const snapshot = buildLifecycleGridSnapshot();
  return [
    { id: 'lifecycle-grid.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleGridRouteSummary(snapshot) },
    { id: 'lifecycle-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

