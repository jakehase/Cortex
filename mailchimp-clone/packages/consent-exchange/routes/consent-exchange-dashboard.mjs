import { buildConsentExchangeSnapshot, createConsentExchangeRouteSummary } from '../service-consent-exchange.mjs';

export function createConsentExchangeDashboardRoutes(basePath = '/consent-exchange') {
  const snapshot = buildConsentExchangeSnapshot();
  return [
    { id: 'consent-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createConsentExchangeRouteSummary(snapshot) },
    { id: 'consent-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

