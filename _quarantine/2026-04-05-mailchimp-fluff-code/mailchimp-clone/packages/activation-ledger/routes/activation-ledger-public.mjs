import { buildActivationLedgerSnapshot } from '../service-activation-ledger.mjs';
import { createActivationLedgerFixtures } from '../fixtures-activation-ledger.mjs';

export function createActivationLedgerPublicRoutes(basePath = '/public/activation-ledger') {
  const snapshot = buildActivationLedgerSnapshot();
  const fixtures = createActivationLedgerFixtures();
  return [
    { id: 'activation-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

