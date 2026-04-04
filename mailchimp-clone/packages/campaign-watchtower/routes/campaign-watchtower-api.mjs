import { buildCampaignWatchtowerSnapshot, createCampaignWatchtowerApiDocument } from '../service-campaign-watchtower.mjs';

export function createCampaignWatchtowerApiRoutes(basePath = '/api/campaign-watchtower') {
  const snapshot = buildCampaignWatchtowerSnapshot();
  return [
    { id: 'campaign-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createCampaignWatchtowerApiDocument(snapshot) }
  ];
}

