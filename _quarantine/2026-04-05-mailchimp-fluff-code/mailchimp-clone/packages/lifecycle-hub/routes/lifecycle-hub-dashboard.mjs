import { buildLifecycleHubSnapshot, createLifecycleHubRouteSummary } from '../service-lifecycle-hub.mjs';

export function createLifecycleHubDashboardRoutes(basePath = '/lifecycle-hub') {
  const snapshot = buildLifecycleHubSnapshot();
  return [
    { id: 'lifecycle-hub.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleHubRouteSummary(snapshot) },
    { id: 'lifecycle-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

