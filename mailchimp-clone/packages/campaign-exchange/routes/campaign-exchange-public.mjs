import { buildCampaignExchangeSnapshot } from '../service-campaign-exchange.mjs';
import { createCampaignExchangeFixtures } from '../fixtures-campaign-exchange.mjs';

export function createCampaignExchangePublicRoutes(basePath = '/public/campaign-exchange') {
  const snapshot = buildCampaignExchangeSnapshot();
  const fixtures = createCampaignExchangeFixtures();
  return [
    { id: 'campaign-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

