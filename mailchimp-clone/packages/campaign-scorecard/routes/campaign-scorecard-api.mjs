import { buildCampaignScorecardSnapshot, createCampaignScorecardApiDocument } from '../service-campaign-scorecard.mjs';

export function createCampaignScorecardApiRoutes(basePath = '/api/campaign-scorecard') {
  const snapshot = buildCampaignScorecardSnapshot();
  return [
    { id: 'campaign-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createCampaignScorecardApiDocument(snapshot) }
  ];
}

