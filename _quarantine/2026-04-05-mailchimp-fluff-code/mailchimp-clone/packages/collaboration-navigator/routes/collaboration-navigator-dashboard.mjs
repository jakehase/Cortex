import { buildCollaborationNavigatorSnapshot, createCollaborationNavigatorRouteSummary } from '../service-collaboration-navigator.mjs';

export function createCollaborationNavigatorDashboardRoutes(basePath = '/collaboration-navigator') {
  const snapshot = buildCollaborationNavigatorSnapshot();
  return [
    { id: 'collaboration-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationNavigatorRouteSummary(snapshot) },
    { id: 'collaboration-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

