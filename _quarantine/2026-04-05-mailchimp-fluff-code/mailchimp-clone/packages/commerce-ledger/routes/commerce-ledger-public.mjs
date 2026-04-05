import { buildCommerceLedgerSnapshot } from '../service-commerce-ledger.mjs';
import { createCommerceLedgerFixtures } from '../fixtures-commerce-ledger.mjs';

export function createCommerceLedgerPublicRoutes(basePath = '/public/commerce-ledger') {
  const snapshot = buildCommerceLedgerSnapshot();
  const fixtures = createCommerceLedgerFixtures();
  return [
    { id: 'commerce-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

