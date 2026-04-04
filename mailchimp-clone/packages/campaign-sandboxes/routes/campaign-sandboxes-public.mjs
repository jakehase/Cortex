import { buildCampaignSandboxesSnapshot } from '../service-campaign-sandboxes.mjs';
import { createCampaignSandboxesFixtures } from '../fixtures-campaign-sandboxes.mjs';

export function createCampaignSandboxesPublicRoutes(basePath = '/public/campaign-sandboxes') { const snapshot = buildCampaignSandboxesSnapshot(); const fixtures = createCampaignSandboxesFixtures(); return [{ id: 'campaign-sandboxes.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'campaign-sandboxes.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'campaign-sandboxes.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

