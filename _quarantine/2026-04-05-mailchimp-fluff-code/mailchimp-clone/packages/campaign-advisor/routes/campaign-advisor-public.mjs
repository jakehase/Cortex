import { buildCampaignAdvisorSnapshot } from '../service-campaign-advisor.mjs';
import { createCampaignAdvisorFixtures } from '../fixtures-campaign-advisor.mjs';

export function createCampaignAdvisorPublicRoutes(basePath = '/public/campaign-advisor') {
  const snapshot = buildCampaignAdvisorSnapshot();
  const fixtures = createCampaignAdvisorFixtures();
  return [
    { id: 'campaign-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

