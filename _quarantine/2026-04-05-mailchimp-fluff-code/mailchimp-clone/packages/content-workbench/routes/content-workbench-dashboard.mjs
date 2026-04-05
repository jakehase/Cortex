import { buildContentWorkbenchSnapshot, createContentWorkbenchRouteSummary } from '../service-content-workbench.mjs';

export function createContentWorkbenchDashboardRoutes(basePath = '/content-workbench') {
  const snapshot = buildContentWorkbenchSnapshot();
  return [
    { id: 'content-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createContentWorkbenchRouteSummary(snapshot) },
    { id: 'content-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

