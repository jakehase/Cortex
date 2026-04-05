import { buildCampaignHubSnapshot, createCampaignHubApiDocument } from '../service-campaign-hub.mjs';

export function createCampaignHubApiRoutes(basePath = '/api/campaign-hub') {
  const snapshot = buildCampaignHubSnapshot();
  return [
    { id: 'campaign-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-hub.api.document', method: 'GET', path: basePath + '/document', document: createCampaignHubApiDocument(snapshot) }
  ];
}

