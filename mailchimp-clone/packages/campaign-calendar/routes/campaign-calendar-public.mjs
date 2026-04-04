import { buildCampaignCalendarSnapshot } from '../service-campaign-calendar.mjs';
import { createCampaignCalendarFixtures } from '../fixtures-campaign-calendar.mjs';

export function createCampaignCalendarPublicRoutes(basePath = '/public/campaign-calendar') {
  const snapshot = buildCampaignCalendarSnapshot();
  const fixtures = createCampaignCalendarFixtures();
  return [
    { id: 'campaign-calendar.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'campaign-calendar.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'campaign-calendar.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
