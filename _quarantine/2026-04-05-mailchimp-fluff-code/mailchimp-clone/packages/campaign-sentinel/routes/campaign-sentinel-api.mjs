import { buildCampaignSentinelSnapshot, createCampaignSentinelApiDocument } from '../service-campaign-sentinel.mjs';

export function createCampaignSentinelApiRoutes(basePath = '/api/campaign-sentinel') {
  const snapshot = buildCampaignSentinelSnapshot();
  return [
    { id: 'campaign-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createCampaignSentinelApiDocument(snapshot) }
  ];
}

