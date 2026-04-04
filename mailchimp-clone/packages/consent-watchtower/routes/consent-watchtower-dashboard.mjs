import { buildConsentWatchtowerSnapshot, createConsentWatchtowerRouteSummary } from '../service-consent-watchtower.mjs';

export function createConsentWatchtowerDashboardRoutes(basePath = '/consent-watchtower') {
  const snapshot = buildConsentWatchtowerSnapshot();
  return [
    { id: 'consent-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createConsentWatchtowerRouteSummary(snapshot) },
    { id: 'consent-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

