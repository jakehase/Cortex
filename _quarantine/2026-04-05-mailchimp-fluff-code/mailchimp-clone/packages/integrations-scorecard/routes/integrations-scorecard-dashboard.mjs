import { buildIntegrationsScorecardSnapshot, createIntegrationsScorecardRouteSummary } from '../service-integrations-scorecard.mjs';

export function createIntegrationsScorecardDashboardRoutes(basePath = '/integrations-scorecard') {
  const snapshot = buildIntegrationsScorecardSnapshot();
  return [
    { id: 'integrations-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsScorecardRouteSummary(snapshot) },
    { id: 'integrations-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

