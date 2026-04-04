import { buildCampaignScorecardSnapshot } from '../service-campaign-scorecard.mjs';
import { createCampaignScorecardFixtures } from '../fixtures-campaign-scorecard.mjs';

export function createCampaignScorecardPublicRoutes(basePath = '/public/campaign-scorecard') {
  const snapshot = buildCampaignScorecardSnapshot();
  const fixtures = createCampaignScorecardFixtures();
  return [
    { id: 'campaign-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

