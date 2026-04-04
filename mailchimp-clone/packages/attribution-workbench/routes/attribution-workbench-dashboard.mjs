import { buildAttributionWorkbenchSnapshot, createAttributionWorkbenchRouteSummary } from '../service-attribution-workbench.mjs';

export function createAttributionWorkbenchDashboardRoutes(basePath = '/attribution-workbench') {
  const snapshot = buildAttributionWorkbenchSnapshot();
  return [
    { id: 'attribution-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionWorkbenchRouteSummary(snapshot) },
    { id: 'attribution-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

