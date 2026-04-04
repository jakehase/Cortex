import { buildAudienceExchangeSnapshot, createAudienceExchangeRouteSummary } from '../service-audience-exchange.mjs';

export function createAudienceExchangeDashboardRoutes(basePath = '/audience-exchange') {
  const snapshot = buildAudienceExchangeSnapshot();
  return [
    { id: 'audience-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceExchangeRouteSummary(snapshot) },
    { id: 'audience-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

