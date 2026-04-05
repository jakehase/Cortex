import { buildCreativeWorkbenchSnapshot, createCreativeWorkbenchRouteSummary } from '../service-creative-workbench.mjs';

export function createCreativeWorkbenchDashboardRoutes(basePath = '/creative-workbench') {
  const snapshot = buildCreativeWorkbenchSnapshot();
  return [
    { id: 'creative-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeWorkbenchRouteSummary(snapshot) },
    { id: 'creative-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

