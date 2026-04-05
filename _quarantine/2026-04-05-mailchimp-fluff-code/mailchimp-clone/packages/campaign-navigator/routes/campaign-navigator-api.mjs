import { buildCampaignNavigatorSnapshot, createCampaignNavigatorApiDocument } from '../service-campaign-navigator.mjs';

export function createCampaignNavigatorApiRoutes(basePath = '/api/campaign-navigator') {
  const snapshot = buildCampaignNavigatorSnapshot();
  return [
    { id: 'campaign-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-navigator.api.document', method: 'GET', path: basePath + '/document', document: createCampaignNavigatorApiDocument(snapshot) }
  ];
}

