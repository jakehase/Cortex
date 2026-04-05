import { buildConsentAdvisorSnapshot, createConsentAdvisorRouteSummary } from '../service-consent-advisor.mjs';

export function createConsentAdvisorDashboardRoutes(basePath = '/consent-advisor') {
  const snapshot = buildConsentAdvisorSnapshot();
  return [
    { id: 'consent-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createConsentAdvisorRouteSummary(snapshot) },
    { id: 'consent-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

