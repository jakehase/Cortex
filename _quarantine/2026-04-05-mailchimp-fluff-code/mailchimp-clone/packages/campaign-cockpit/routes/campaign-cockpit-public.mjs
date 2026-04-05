import { buildCampaignCockpitSnapshot } from '../service-campaign-cockpit.mjs';
import { createCampaignCockpitFixtures } from '../fixtures-campaign-cockpit.mjs';

export function createCampaignCockpitPublicRoutes(basePath = '/public/campaign-cockpit') {
  const snapshot = buildCampaignCockpitSnapshot();
  const fixtures = createCampaignCockpitFixtures();
  return [
    { id: 'campaign-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

