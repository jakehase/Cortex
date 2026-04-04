import { buildCampaignIndexSnapshot, createCampaignIndexApiDocument } from '../service-campaign-index.mjs';

export function createCampaignIndexApiRoutes(basePath = '/api/campaign-index') {
  const snapshot = buildCampaignIndexSnapshot();
  return [
    { id: 'campaign-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-index.api.document', method: 'GET', path: basePath + '/document', document: createCampaignIndexApiDocument(snapshot) }
  ];
}

