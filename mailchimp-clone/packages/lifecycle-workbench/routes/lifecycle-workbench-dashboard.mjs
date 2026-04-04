import { buildLifecycleWorkbenchSnapshot, createLifecycleWorkbenchRouteSummary } from '../service-lifecycle-workbench.mjs';

export function createLifecycleWorkbenchDashboardRoutes(basePath = '/lifecycle-workbench') {
  const snapshot = buildLifecycleWorkbenchSnapshot();
  return [
    { id: 'lifecycle-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleWorkbenchRouteSummary(snapshot) },
    { id: 'lifecycle-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

