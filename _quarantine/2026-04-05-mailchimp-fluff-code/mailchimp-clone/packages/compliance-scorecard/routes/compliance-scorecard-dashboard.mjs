import { buildComplianceScorecardSnapshot, createComplianceScorecardRouteSummary } from '../service-compliance-scorecard.mjs';

export function createComplianceScorecardDashboardRoutes(basePath = '/compliance-scorecard') {
  const snapshot = buildComplianceScorecardSnapshot();
  return [
    { id: 'compliance-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceScorecardRouteSummary(snapshot) },
    { id: 'compliance-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

