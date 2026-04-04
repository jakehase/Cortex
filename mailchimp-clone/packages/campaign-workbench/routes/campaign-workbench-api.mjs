import { buildCampaignWorkbenchSnapshot, createCampaignWorkbenchApiDocument } from '../service-campaign-workbench.mjs';

export function createCampaignWorkbenchApiRoutes(basePath = '/api/campaign-workbench') {
  const snapshot = buildCampaignWorkbenchSnapshot();
  return [
    { id: 'campaign-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-workbench.api.document', method: 'GET', path: basePath + '/document', document: createCampaignWorkbenchApiDocument(snapshot) }
  ];
}

