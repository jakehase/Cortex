import { buildCampaignGridSnapshot } from '../service-campaign-grid.mjs';
import { createCampaignGridFixtures } from '../fixtures-campaign-grid.mjs';

export function createCampaignGridPublicRoutes(basePath = '/public/campaign-grid') {
  const snapshot = buildCampaignGridSnapshot();
  const fixtures = createCampaignGridFixtures();
  return [
    { id: 'campaign-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

