import { buildConsentSentinelSnapshot, createConsentSentinelRouteSummary } from '../service-consent-sentinel.mjs';

export function createConsentSentinelDashboardRoutes(basePath = '/consent-sentinel') {
  const snapshot = buildConsentSentinelSnapshot();
  return [
    { id: 'consent-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createConsentSentinelRouteSummary(snapshot) },
    { id: 'consent-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

