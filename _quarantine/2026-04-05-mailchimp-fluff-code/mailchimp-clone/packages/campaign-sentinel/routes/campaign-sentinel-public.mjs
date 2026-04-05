import { buildCampaignSentinelSnapshot } from '../service-campaign-sentinel.mjs';
import { createCampaignSentinelFixtures } from '../fixtures-campaign-sentinel.mjs';

export function createCampaignSentinelPublicRoutes(basePath = '/public/campaign-sentinel') {
  const snapshot = buildCampaignSentinelSnapshot();
  const fixtures = createCampaignSentinelFixtures();
  return [
    { id: 'campaign-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

