import { buildCampaignNotebookSnapshot } from '../service-campaign-notebook.mjs';
import { createCampaignNotebookFixtures } from '../fixtures-campaign-notebook.mjs';

export function createCampaignNotebookPublicRoutes(basePath = '/public/campaign-notebook') {
  const snapshot = buildCampaignNotebookSnapshot();
  const fixtures = createCampaignNotebookFixtures();
  return [
    { id: 'campaign-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

