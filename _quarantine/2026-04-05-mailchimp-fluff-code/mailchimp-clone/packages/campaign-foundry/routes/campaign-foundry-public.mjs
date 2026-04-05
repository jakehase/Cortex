import { buildCampaignFoundrySnapshot } from '../service-campaign-foundry.mjs';
import { createCampaignFoundryFixtures } from '../fixtures-campaign-foundry.mjs';

export function createCampaignFoundryPublicRoutes(basePath = '/public/campaign-foundry') {
  const snapshot = buildCampaignFoundrySnapshot();
  const fixtures = createCampaignFoundryFixtures();
  return [
    { id: 'campaign-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

