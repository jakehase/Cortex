import { buildLifecycleStudioSnapshot, createLifecycleStudioRouteSummary } from '../service-lifecycle-studio.mjs';

export function createLifecycleStudioDashboardRoutes(basePath = '/lifecycle-studio') {
  const snapshot = buildLifecycleStudioSnapshot();
  return [
    { id: 'lifecycle-studio.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleStudioRouteSummary(snapshot) },
    { id: 'lifecycle-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

