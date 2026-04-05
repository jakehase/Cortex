import { buildCollaborationAdvisorSnapshot, createCollaborationAdvisorRouteSummary } from '../service-collaboration-advisor.mjs';

export function createCollaborationAdvisorDashboardRoutes(basePath = '/collaboration-advisor') {
  const snapshot = buildCollaborationAdvisorSnapshot();
  return [
    { id: 'collaboration-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationAdvisorRouteSummary(snapshot) },
    { id: 'collaboration-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

