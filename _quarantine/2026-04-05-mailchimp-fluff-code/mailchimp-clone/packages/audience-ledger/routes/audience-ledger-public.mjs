import { buildAudienceLedgerSnapshot } from '../service-audience-ledger.mjs';
import { createAudienceLedgerFixtures } from '../fixtures-audience-ledger.mjs';

export function createAudienceLedgerPublicRoutes(basePath = '/public/audience-ledger') {
  const snapshot = buildAudienceLedgerSnapshot();
  const fixtures = createAudienceLedgerFixtures();
  return [
    { id: 'audience-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

