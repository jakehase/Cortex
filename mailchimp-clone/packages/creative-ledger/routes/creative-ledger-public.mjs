import { buildCreativeLedgerSnapshot } from '../service-creative-ledger.mjs';
import { createCreativeLedgerFixtures } from '../fixtures-creative-ledger.mjs';

export function createCreativeLedgerPublicRoutes(basePath = '/public/creative-ledger') {
  const snapshot = buildCreativeLedgerSnapshot();
  const fixtures = createCreativeLedgerFixtures();
  return [
    { id: 'creative-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

