import { buildCampaignLedgerSnapshot } from '../service-campaign-ledger.mjs';
import { createCampaignLedgerFixtures } from '../fixtures-campaign-ledger.mjs';

export function createCampaignLedgerPublicRoutes(basePath = '/public/campaign-ledger') {
  const snapshot = buildCampaignLedgerSnapshot();
  const fixtures = createCampaignLedgerFixtures();
  return [
    { id: 'campaign-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

