import { buildLifecycleIndexSnapshot, createLifecycleIndexRouteSummary } from '../service-lifecycle-index.mjs';

export function createLifecycleIndexDashboardRoutes(basePath = '/lifecycle-index') {
  const snapshot = buildLifecycleIndexSnapshot();
  return [
    { id: 'lifecycle-index.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleIndexRouteSummary(snapshot) },
    { id: 'lifecycle-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

