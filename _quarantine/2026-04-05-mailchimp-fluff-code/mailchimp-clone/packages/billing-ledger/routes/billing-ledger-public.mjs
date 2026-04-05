import { buildBillingLedgerSnapshot } from '../service-billing-ledger.mjs';
import { createBillingLedgerFixtures } from '../fixtures-billing-ledger.mjs';

export function createBillingLedgerPublicRoutes(basePath = '/public/billing-ledger') {
  const snapshot = buildBillingLedgerSnapshot();
  const fixtures = createBillingLedgerFixtures();
  return [
    { id: 'billing-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

