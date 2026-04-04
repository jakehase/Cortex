import { buildContentLedgerSnapshot } from '../service-content-ledger.mjs';
import { createContentLedgerFixtures } from '../fixtures-content-ledger.mjs';

export function createContentLedgerPublicRoutes(basePath = '/public/content-ledger') {
  const snapshot = buildContentLedgerSnapshot();
  const fixtures = createContentLedgerFixtures();
  return [
    { id: 'content-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

