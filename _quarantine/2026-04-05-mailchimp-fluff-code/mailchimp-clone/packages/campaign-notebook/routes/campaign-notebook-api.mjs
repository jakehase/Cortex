import { buildCampaignNotebookSnapshot, createCampaignNotebookApiDocument } from '../service-campaign-notebook.mjs';

export function createCampaignNotebookApiRoutes(basePath = '/api/campaign-notebook') {
  const snapshot = buildCampaignNotebookSnapshot();
  return [
    { id: 'campaign-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-notebook.api.document', method: 'GET', path: basePath + '/document', document: createCampaignNotebookApiDocument(snapshot) }
  ];
}

