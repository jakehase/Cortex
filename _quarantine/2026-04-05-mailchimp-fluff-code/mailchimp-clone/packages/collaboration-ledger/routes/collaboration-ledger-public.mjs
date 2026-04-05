import { buildCollaborationLedgerSnapshot } from '../service-collaboration-ledger.mjs';
import { createCollaborationLedgerFixtures } from '../fixtures-collaboration-ledger.mjs';

export function createCollaborationLedgerPublicRoutes(basePath = '/public/collaboration-ledger') {
  const snapshot = buildCollaborationLedgerSnapshot();
  const fixtures = createCollaborationLedgerFixtures();
  return [
    { id: 'collaboration-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

