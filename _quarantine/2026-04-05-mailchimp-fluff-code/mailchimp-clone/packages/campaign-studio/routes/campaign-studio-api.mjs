import { buildCampaignStudioSnapshot, createCampaignStudioApiDocument } from '../service-campaign-studio.mjs';

export function createCampaignStudioApiRoutes(basePath = '/api/campaign-studio') {
  const snapshot = buildCampaignStudioSnapshot();
  return [
    { id: 'campaign-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-studio.api.document', method: 'GET', path: basePath + '/document', document: createCampaignStudioApiDocument(snapshot) }
  ];
}

