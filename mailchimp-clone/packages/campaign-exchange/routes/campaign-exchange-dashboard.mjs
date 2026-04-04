import { buildCampaignExchangeSnapshot, createCampaignExchangeRouteSummary } from '../service-campaign-exchange.mjs';

export function createCampaignExchangeDashboardRoutes(basePath = '/campaign-exchange') {
  const snapshot = buildCampaignExchangeSnapshot();
  return [
    { id: 'campaign-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignExchangeRouteSummary(snapshot) },
    { id: 'campaign-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

