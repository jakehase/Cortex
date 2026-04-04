import { buildCampaignIndexSnapshot } from '../service-campaign-index.mjs';
import { createCampaignIndexFixtures } from '../fixtures-campaign-index.mjs';

export function createCampaignIndexPublicRoutes(basePath = '/public/campaign-index') {
  const snapshot = buildCampaignIndexSnapshot();
  const fixtures = createCampaignIndexFixtures();
  return [
    { id: 'campaign-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

