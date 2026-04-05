import { buildConsentGridSnapshot, createConsentGridRouteSummary } from '../service-consent-grid.mjs';

export function createConsentGridDashboardRoutes(basePath = '/consent-grid') {
  const snapshot = buildConsentGridSnapshot();
  return [
    { id: 'consent-grid.dashboard.overview', method: 'GET', path: basePath, summary: createConsentGridRouteSummary(snapshot) },
    { id: 'consent-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

