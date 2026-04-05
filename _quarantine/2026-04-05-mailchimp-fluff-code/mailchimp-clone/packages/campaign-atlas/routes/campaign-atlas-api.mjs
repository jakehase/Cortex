import { buildCampaignAtlasSnapshot, createCampaignAtlasApiDocument } from '../service-campaign-atlas.mjs';

export function createCampaignAtlasApiRoutes(basePath = '/api/campaign-atlas') {
  const snapshot = buildCampaignAtlasSnapshot();
  return [
    { id: 'campaign-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-atlas.api.document', method: 'GET', path: basePath + '/document', document: createCampaignAtlasApiDocument(snapshot) }
  ];
}

