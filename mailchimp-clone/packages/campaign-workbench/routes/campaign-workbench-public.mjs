import { buildCampaignWorkbenchSnapshot } from '../service-campaign-workbench.mjs';
import { createCampaignWorkbenchFixtures } from '../fixtures-campaign-workbench.mjs';

export function createCampaignWorkbenchPublicRoutes(basePath = '/public/campaign-workbench') {
  const snapshot = buildCampaignWorkbenchSnapshot();
  const fixtures = createCampaignWorkbenchFixtures();
  return [
    { id: 'campaign-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

