import { buildAutomationLedgerSnapshot } from '../service-automation-ledger.mjs';
import { createAutomationLedgerFixtures } from '../fixtures-automation-ledger.mjs';

export function createAutomationLedgerPublicRoutes(basePath = '/public/automation-ledger') {
  const snapshot = buildAutomationLedgerSnapshot();
  const fixtures = createAutomationLedgerFixtures();
  return [
    { id: 'automation-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

