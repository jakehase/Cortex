import { buildCampaignStudioSnapshot } from '../service-campaign-studio.mjs';
import { createCampaignStudioFixtures } from '../fixtures-campaign-studio.mjs';

export function createCampaignStudioPublicRoutes(basePath = '/public/campaign-studio') {
  const snapshot = buildCampaignStudioSnapshot();
  const fixtures = createCampaignStudioFixtures();
  return [
    { id: 'campaign-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

