import { buildCollaborationWorkbenchSnapshot, createCollaborationWorkbenchRouteSummary } from '../service-collaboration-workbench.mjs';

export function createCollaborationWorkbenchDashboardRoutes(basePath = '/collaboration-workbench') {
  const snapshot = buildCollaborationWorkbenchSnapshot();
  return [
    { id: 'collaboration-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationWorkbenchRouteSummary(snapshot) },
    { id: 'collaboration-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

