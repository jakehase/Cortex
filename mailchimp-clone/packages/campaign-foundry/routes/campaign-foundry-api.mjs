import { buildCampaignFoundrySnapshot, createCampaignFoundryApiDocument } from '../service-campaign-foundry.mjs';

export function createCampaignFoundryApiRoutes(basePath = '/api/campaign-foundry') {
  const snapshot = buildCampaignFoundrySnapshot();
  return [
    { id: 'campaign-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-foundry.api.document', method: 'GET', path: basePath + '/document', document: createCampaignFoundryApiDocument(snapshot) }
  ];
}

