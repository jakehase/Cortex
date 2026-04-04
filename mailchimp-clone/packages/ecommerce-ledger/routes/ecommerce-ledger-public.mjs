import { buildEcommerceLedgerSnapshot } from '../service-ecommerce-ledger.mjs';
import { createEcommerceLedgerFixtures } from '../fixtures-ecommerce-ledger.mjs';

export function createEcommerceLedgerPublicRoutes(basePath = '/public/ecommerce-ledger') {
  const snapshot = buildEcommerceLedgerSnapshot();
  const fixtures = createEcommerceLedgerFixtures();
  return [
    { id: 'ecommerce-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

