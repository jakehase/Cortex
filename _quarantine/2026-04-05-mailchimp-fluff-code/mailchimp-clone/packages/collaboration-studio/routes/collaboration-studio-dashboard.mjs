import { buildCollaborationStudioSnapshot, createCollaborationStudioRouteSummary } from '../service-collaboration-studio.mjs';

export function createCollaborationStudioDashboardRoutes(basePath = '/collaboration-studio') {
  const snapshot = buildCollaborationStudioSnapshot();
  return [
    { id: 'collaboration-studio.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationStudioRouteSummary(snapshot) },
    { id: 'collaboration-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

