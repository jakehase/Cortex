import { buildCampaignHubSnapshot } from '../service-campaign-hub.mjs';
import { createCampaignHubFixtures } from '../fixtures-campaign-hub.mjs';

export function createCampaignHubPublicRoutes(basePath = '/public/campaign-hub') {
  const snapshot = buildCampaignHubSnapshot();
  const fixtures = createCampaignHubFixtures();
  return [
    { id: 'campaign-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

