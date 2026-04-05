import { buildCollaborationIndexSnapshot, createCollaborationIndexRouteSummary } from '../service-collaboration-index.mjs';

export function createCollaborationIndexDashboardRoutes(basePath = '/collaboration-index') {
  const snapshot = buildCollaborationIndexSnapshot();
  return [
    { id: 'collaboration-index.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationIndexRouteSummary(snapshot) },
    { id: 'collaboration-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

