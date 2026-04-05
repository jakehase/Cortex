import { buildAcquisitionLedgerSnapshot } from '../service-acquisition-ledger.mjs';
import { createAcquisitionLedgerFixtures } from '../fixtures-acquisition-ledger.mjs';

export function createAcquisitionLedgerPublicRoutes(basePath = '/public/acquisition-ledger') {
  const snapshot = buildAcquisitionLedgerSnapshot();
  const fixtures = createAcquisitionLedgerFixtures();
  return [
    { id: 'acquisition-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

