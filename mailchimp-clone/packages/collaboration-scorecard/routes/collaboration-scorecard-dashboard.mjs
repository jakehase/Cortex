import { buildCollaborationScorecardSnapshot, createCollaborationScorecardRouteSummary } from '../service-collaboration-scorecard.mjs';

export function createCollaborationScorecardDashboardRoutes(basePath = '/collaboration-scorecard') {
  const snapshot = buildCollaborationScorecardSnapshot();
  return [
    { id: 'collaboration-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationScorecardRouteSummary(snapshot) },
    { id: 'collaboration-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

