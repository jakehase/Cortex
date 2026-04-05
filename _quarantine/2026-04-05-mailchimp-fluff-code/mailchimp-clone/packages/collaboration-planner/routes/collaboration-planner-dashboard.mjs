import { buildCollaborationPlannerSnapshot, createCollaborationPlannerRouteSummary } from '../service-collaboration-planner.mjs';

export function createCollaborationPlannerDashboardRoutes(basePath = '/collaboration-planner') {
  const snapshot = buildCollaborationPlannerSnapshot();
  return [
    { id: 'collaboration-planner.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationPlannerRouteSummary(snapshot) },
    { id: 'collaboration-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

