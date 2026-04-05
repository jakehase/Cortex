import { buildCampaignAtlasSnapshot } from '../service-campaign-atlas.mjs';
import { createCampaignAtlasFixtures } from '../fixtures-campaign-atlas.mjs';

export function createCampaignAtlasPublicRoutes(basePath = '/public/campaign-atlas') {
  const snapshot = buildCampaignAtlasSnapshot();
  const fixtures = createCampaignAtlasFixtures();
  return [
    { id: 'campaign-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

