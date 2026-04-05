import { buildAdvocacyLedgerSnapshot } from '../service-advocacy-ledger.mjs';
import { createAdvocacyLedgerFixtures } from '../fixtures-advocacy-ledger.mjs';

export function createAdvocacyLedgerPublicRoutes(basePath = '/public/advocacy-ledger') {
  const snapshot = buildAdvocacyLedgerSnapshot();
  const fixtures = createAdvocacyLedgerFixtures();
  return [
    { id: 'advocacy-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

