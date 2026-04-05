import { buildCampaignAdvisorSnapshot, createCampaignAdvisorApiDocument } from '../service-campaign-advisor.mjs';

export function createCampaignAdvisorApiRoutes(basePath = '/api/campaign-advisor') {
  const snapshot = buildCampaignAdvisorSnapshot();
  return [
    { id: 'campaign-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-advisor.api.document', method: 'GET', path: basePath + '/document', document: createCampaignAdvisorApiDocument(snapshot) }
  ];
}

