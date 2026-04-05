import { buildCampaignPlannerSnapshot } from '../service-campaign-planner.mjs';
import { createCampaignPlannerFixtures } from '../fixtures-campaign-planner.mjs';

export function createCampaignPlannerPublicRoutes(basePath = '/public/campaign-planner') {
  const snapshot = buildCampaignPlannerSnapshot();
  const fixtures = createCampaignPlannerFixtures();
  return [
    { id: 'campaign-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

