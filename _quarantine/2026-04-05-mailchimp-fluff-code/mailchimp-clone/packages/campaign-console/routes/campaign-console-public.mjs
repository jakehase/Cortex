import { buildCampaignConsoleSnapshot } from '../service-campaign-console.mjs';
import { createCampaignConsoleFixtures } from '../fixtures-campaign-console.mjs';

export function createCampaignConsolePublicRoutes(basePath = '/public/campaign-console') {
  const snapshot = buildCampaignConsoleSnapshot();
  const fixtures = createCampaignConsoleFixtures();
  return [
    { id: 'campaign-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

