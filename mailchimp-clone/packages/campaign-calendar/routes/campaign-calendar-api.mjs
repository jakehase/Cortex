import { buildCampaignCalendarSnapshot, createCampaignCalendarApiDocument } from '../service-campaign-calendar.mjs';

export function createCampaignCalendarApiRoutes(basePath = '/api/campaign-calendar') {
  const snapshot = buildCampaignCalendarSnapshot();
  return [
    { id: 'campaign-calendar.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'campaign-calendar.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'campaign-calendar.api.document', method: 'GET', path: basePath + '/document', document: createCampaignCalendarApiDocument(snapshot) }
  ];
}
