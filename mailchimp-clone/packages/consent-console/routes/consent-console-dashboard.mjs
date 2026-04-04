import { buildConsentConsoleSnapshot, createConsentConsoleRouteSummary } from '../service-consent-console.mjs';

export function createConsentConsoleDashboardRoutes(basePath = '/consent-console') {
  const snapshot = buildConsentConsoleSnapshot();
  return [
    { id: 'consent-console.dashboard.overview', method: 'GET', path: basePath, summary: createConsentConsoleRouteSummary(snapshot) },
    { id: 'consent-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

