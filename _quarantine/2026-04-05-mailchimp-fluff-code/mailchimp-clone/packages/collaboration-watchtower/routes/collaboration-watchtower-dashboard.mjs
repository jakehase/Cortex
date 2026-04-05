import { buildCollaborationWatchtowerSnapshot, createCollaborationWatchtowerRouteSummary } from '../service-collaboration-watchtower.mjs';

export function createCollaborationWatchtowerDashboardRoutes(basePath = '/collaboration-watchtower') {
  const snapshot = buildCollaborationWatchtowerSnapshot();
  return [
    { id: 'collaboration-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationWatchtowerRouteSummary(snapshot) },
    { id: 'collaboration-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

