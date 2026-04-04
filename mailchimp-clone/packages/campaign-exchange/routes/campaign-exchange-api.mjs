import { buildCampaignExchangeSnapshot, createCampaignExchangeApiDocument } from '../service-campaign-exchange.mjs';

export function createCampaignExchangeApiRoutes(basePath = '/api/campaign-exchange') {
  const snapshot = buildCampaignExchangeSnapshot();
  return [
    { id: 'campaign-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-exchange.api.document', method: 'GET', path: basePath + '/document', document: createCampaignExchangeApiDocument(snapshot) }
  ];
}

