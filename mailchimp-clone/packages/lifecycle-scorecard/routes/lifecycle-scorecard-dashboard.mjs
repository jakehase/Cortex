import { buildLifecycleScorecardSnapshot, createLifecycleScorecardRouteSummary } from '../service-lifecycle-scorecard.mjs';

export function createLifecycleScorecardDashboardRoutes(basePath = '/lifecycle-scorecard') {
  const snapshot = buildLifecycleScorecardSnapshot();
  return [
    { id: 'lifecycle-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleScorecardRouteSummary(snapshot) },
    { id: 'lifecycle-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

