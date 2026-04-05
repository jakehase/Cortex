import { buildConsentStudioSnapshot, createConsentStudioRouteSummary } from '../service-consent-studio.mjs';

export function createConsentStudioDashboardRoutes(basePath = '/consent-studio') {
  const snapshot = buildConsentStudioSnapshot();
  return [
    { id: 'consent-studio.dashboard.overview', method: 'GET', path: basePath, summary: createConsentStudioRouteSummary(snapshot) },
    { id: 'consent-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

