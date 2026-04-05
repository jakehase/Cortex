import { buildConsentHubSnapshot, createConsentHubRouteSummary } from '../service-consent-hub.mjs';

export function createConsentHubDashboardRoutes(basePath = '/consent-hub') {
  const snapshot = buildConsentHubSnapshot();
  return [
    { id: 'consent-hub.dashboard.overview', method: 'GET', path: basePath, summary: createConsentHubRouteSummary(snapshot) },
    { id: 'consent-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

