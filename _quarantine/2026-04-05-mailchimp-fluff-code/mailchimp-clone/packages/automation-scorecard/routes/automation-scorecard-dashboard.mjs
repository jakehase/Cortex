import { buildAutomationScorecardSnapshot, createAutomationScorecardRouteSummary } from '../service-automation-scorecard.mjs';

export function createAutomationScorecardDashboardRoutes(basePath = '/automation-scorecard') {
  const snapshot = buildAutomationScorecardSnapshot();
  return [
    { id: 'automation-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationScorecardRouteSummary(snapshot) },
    { id: 'automation-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

