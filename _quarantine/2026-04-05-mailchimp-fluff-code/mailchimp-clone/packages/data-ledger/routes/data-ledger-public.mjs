import { buildDataLedgerSnapshot } from '../service-data-ledger.mjs';
import { createDataLedgerFixtures } from '../fixtures-data-ledger.mjs';

export function createDataLedgerPublicRoutes(basePath = '/public/data-ledger') {
  const snapshot = buildDataLedgerSnapshot();
  const fixtures = createDataLedgerFixtures();
  return [
    { id: 'data-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

