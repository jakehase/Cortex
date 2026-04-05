import { buildCampaignPlannerSnapshot, createCampaignPlannerApiDocument } from '../service-campaign-planner.mjs';

export function createCampaignPlannerApiRoutes(basePath = '/api/campaign-planner') {
  const snapshot = buildCampaignPlannerSnapshot();
  return [
    { id: 'campaign-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-planner.api.document', method: 'GET', path: basePath + '/document', document: createCampaignPlannerApiDocument(snapshot) }
  ];
}

