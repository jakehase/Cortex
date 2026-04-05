import { buildCollaborationHubSnapshot, createCollaborationHubRouteSummary } from '../service-collaboration-hub.mjs';

export function createCollaborationHubDashboardRoutes(basePath = '/collaboration-hub') {
  const snapshot = buildCollaborationHubSnapshot();
  return [
    { id: 'collaboration-hub.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationHubRouteSummary(snapshot) },
    { id: 'collaboration-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

