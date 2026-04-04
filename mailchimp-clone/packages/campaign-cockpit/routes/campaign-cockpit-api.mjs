import { buildCampaignCockpitSnapshot, createCampaignCockpitApiDocument } from '../service-campaign-cockpit.mjs';

export function createCampaignCockpitApiRoutes(basePath = '/api/campaign-cockpit') {
  const snapshot = buildCampaignCockpitSnapshot();
  return [
    { id: 'campaign-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'campaign-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createCampaignCockpitApiDocument(snapshot) }
  ];
}

