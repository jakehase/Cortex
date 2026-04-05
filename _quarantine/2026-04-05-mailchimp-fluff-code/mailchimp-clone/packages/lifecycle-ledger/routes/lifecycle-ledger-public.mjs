import { buildLifecycleLedgerSnapshot } from '../service-lifecycle-ledger.mjs';
import { createLifecycleLedgerFixtures } from '../fixtures-lifecycle-ledger.mjs';

export function createLifecycleLedgerPublicRoutes(basePath = '/public/lifecycle-ledger') {
  const snapshot = buildLifecycleLedgerSnapshot();
  const fixtures = createLifecycleLedgerFixtures();
  return [
    { id: 'lifecycle-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

