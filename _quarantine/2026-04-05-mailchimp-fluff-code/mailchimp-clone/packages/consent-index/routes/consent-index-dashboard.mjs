import { buildConsentIndexSnapshot, createConsentIndexRouteSummary } from '../service-consent-index.mjs';

export function createConsentIndexDashboardRoutes(basePath = '/consent-index') {
  const snapshot = buildConsentIndexSnapshot();
  return [
    { id: 'consent-index.dashboard.overview', method: 'GET', path: basePath, summary: createConsentIndexRouteSummary(snapshot) },
    { id: 'consent-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

