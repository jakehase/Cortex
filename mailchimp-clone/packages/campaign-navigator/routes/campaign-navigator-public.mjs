import { buildCampaignNavigatorSnapshot } from '../service-campaign-navigator.mjs';
import { createCampaignNavigatorFixtures } from '../fixtures-campaign-navigator.mjs';

export function createCampaignNavigatorPublicRoutes(basePath = '/public/campaign-navigator') {
  const snapshot = buildCampaignNavigatorSnapshot();
  const fixtures = createCampaignNavigatorFixtures();
  return [
    { id: 'campaign-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

