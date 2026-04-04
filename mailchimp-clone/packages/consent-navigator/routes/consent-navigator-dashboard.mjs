import { buildConsentNavigatorSnapshot, createConsentNavigatorRouteSummary } from '../service-consent-navigator.mjs';

export function createConsentNavigatorDashboardRoutes(basePath = '/consent-navigator') {
  const snapshot = buildConsentNavigatorSnapshot();
  return [
    { id: 'consent-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createConsentNavigatorRouteSummary(snapshot) },
    { id: 'consent-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

