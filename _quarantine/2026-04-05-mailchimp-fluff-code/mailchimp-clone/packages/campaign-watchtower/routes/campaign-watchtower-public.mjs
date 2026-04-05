import { buildCampaignWatchtowerSnapshot } from '../service-campaign-watchtower.mjs';
import { createCampaignWatchtowerFixtures } from '../fixtures-campaign-watchtower.mjs';

export function createCampaignWatchtowerPublicRoutes(basePath = '/public/campaign-watchtower') {
  const snapshot = buildCampaignWatchtowerSnapshot();
  const fixtures = createCampaignWatchtowerFixtures();
  return [
    { id: 'campaign-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

