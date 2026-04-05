import { buildConsentScorecardSnapshot, createConsentScorecardRouteSummary } from '../service-consent-scorecard.mjs';

export function createConsentScorecardDashboardRoutes(basePath = '/consent-scorecard') {
  const snapshot = buildConsentScorecardSnapshot();
  return [
    { id: 'consent-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createConsentScorecardRouteSummary(snapshot) },
    { id: 'consent-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

