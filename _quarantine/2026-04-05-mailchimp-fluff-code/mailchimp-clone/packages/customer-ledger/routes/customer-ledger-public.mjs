import { buildCustomerLedgerSnapshot } from '../service-customer-ledger.mjs';
import { createCustomerLedgerFixtures } from '../fixtures-customer-ledger.mjs';

export function createCustomerLedgerPublicRoutes(basePath = '/public/customer-ledger') {
  const snapshot = buildCustomerLedgerSnapshot();
  const fixtures = createCustomerLedgerFixtures();
  return [
    { id: 'customer-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

