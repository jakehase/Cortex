import { buildDataWorkbenchSnapshot, createDataWorkbenchRouteSummary } from '../service-data-workbench.mjs';

export function createDataWorkbenchDashboardRoutes(basePath = '/data-workbench') {
  const snapshot = buildDataWorkbenchSnapshot();
  return [
    { id: 'data-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createDataWorkbenchRouteSummary(snapshot) },
    { id: 'data-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

