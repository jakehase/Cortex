import { buildCollaborationGridSnapshot, createCollaborationGridRouteSummary } from '../service-collaboration-grid.mjs';

export function createCollaborationGridDashboardRoutes(basePath = '/collaboration-grid') {
  const snapshot = buildCollaborationGridSnapshot();
  return [
    { id: 'collaboration-grid.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationGridRouteSummary(snapshot) },
    { id: 'collaboration-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

