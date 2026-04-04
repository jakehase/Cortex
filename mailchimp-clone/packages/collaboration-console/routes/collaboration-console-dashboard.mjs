import { buildCollaborationConsoleSnapshot, createCollaborationConsoleRouteSummary } from '../service-collaboration-console.mjs';

export function createCollaborationConsoleDashboardRoutes(basePath = '/collaboration-console') {
  const snapshot = buildCollaborationConsoleSnapshot();
  return [
    { id: 'collaboration-console.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationConsoleRouteSummary(snapshot) },
    { id: 'collaboration-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

