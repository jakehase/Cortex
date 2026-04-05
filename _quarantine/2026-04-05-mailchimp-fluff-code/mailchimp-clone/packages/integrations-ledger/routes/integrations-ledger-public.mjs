import { buildIntegrationsLedgerSnapshot } from '../service-integrations-ledger.mjs';
import { createIntegrationsLedgerFixtures } from '../fixtures-integrations-ledger.mjs';

export function createIntegrationsLedgerPublicRoutes(basePath = '/public/integrations-ledger') {
  const snapshot = buildIntegrationsLedgerSnapshot();
  const fixtures = createIntegrationsLedgerFixtures();
  return [
    { id: 'integrations-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

