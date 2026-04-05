import { buildDeliverabilityLedgerSnapshot } from '../service-deliverability-ledger.mjs';
import { createDeliverabilityLedgerFixtures } from '../fixtures-deliverability-ledger.mjs';

export function createDeliverabilityLedgerPublicRoutes(basePath = '/public/deliverability-ledger') {
  const snapshot = buildDeliverabilityLedgerSnapshot();
  const fixtures = createDeliverabilityLedgerFixtures();
  return [
    { id: 'deliverability-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

