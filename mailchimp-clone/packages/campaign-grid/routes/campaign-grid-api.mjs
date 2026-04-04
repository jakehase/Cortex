import { buildCampaignGridSnapshot, createCampaignGridApiDocument } from '../service-campaign-grid.mjs';

export function createCampaignGridApiRoutes(basePath = '/api/campaign-grid') {
  const snapshot = buildCampaignGridSnapshot();
  return [
    { id: 'campaign-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-grid.api.document', method: 'GET', path: basePath + '/document', document: createCampaignGridApiDocument(snapshot) }
  ];
}

