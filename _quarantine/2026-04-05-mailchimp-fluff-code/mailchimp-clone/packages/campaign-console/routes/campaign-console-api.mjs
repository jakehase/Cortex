import { buildCampaignConsoleSnapshot, createCampaignConsoleApiDocument } from '../service-campaign-console.mjs';

export function createCampaignConsoleApiRoutes(basePath = '/api/campaign-console') {
  const snapshot = buildCampaignConsoleSnapshot();
  return [
    { id: 'campaign-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-console.api.document', method: 'GET', path: basePath + '/document', document: createCampaignConsoleApiDocument(snapshot) }
  ];
}

