import { buildCollaborationFoundrySnapshot, createCollaborationFoundryRouteSummary } from '../service-collaboration-foundry.mjs';

export function createCollaborationFoundryDashboardRoutes(basePath = '/collaboration-foundry') {
  const snapshot = buildCollaborationFoundrySnapshot();
  return [
    { id: 'collaboration-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationFoundryRouteSummary(snapshot) },
    { id: 'collaboration-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

