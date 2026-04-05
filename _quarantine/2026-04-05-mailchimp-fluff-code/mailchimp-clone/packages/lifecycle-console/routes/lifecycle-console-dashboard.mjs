import { buildLifecycleConsoleSnapshot, createLifecycleConsoleRouteSummary } from '../service-lifecycle-console.mjs';

export function createLifecycleConsoleDashboardRoutes(basePath = '/lifecycle-console') {
  const snapshot = buildLifecycleConsoleSnapshot();
  return [
    { id: 'lifecycle-console.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleConsoleRouteSummary(snapshot) },
    { id: 'lifecycle-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

