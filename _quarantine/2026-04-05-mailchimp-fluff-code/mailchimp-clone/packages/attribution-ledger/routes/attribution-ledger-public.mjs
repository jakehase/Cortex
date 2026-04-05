import { buildAttributionLedgerSnapshot } from '../service-attribution-ledger.mjs';
import { createAttributionLedgerFixtures } from '../fixtures-attribution-ledger.mjs';

export function createAttributionLedgerPublicRoutes(basePath = '/public/attribution-ledger') {
  const snapshot = buildAttributionLedgerSnapshot();
  const fixtures = createAttributionLedgerFixtures();
  return [
    { id: 'attribution-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

