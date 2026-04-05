import { buildLoyaltyLedgerSnapshot } from '../service-loyalty-ledger.mjs';
import { createLoyaltyLedgerFixtures } from '../fixtures-loyalty-ledger.mjs';

export function createLoyaltyLedgerPublicRoutes(basePath = '/public/loyalty-ledger') {
  const snapshot = buildLoyaltyLedgerSnapshot();
  const fixtures = createLoyaltyLedgerFixtures();
  return [
    { id: 'loyalty-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

