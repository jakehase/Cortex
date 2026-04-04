import { buildComplianceLedgerSnapshot } from '../service-compliance-ledger.mjs';
import { createComplianceLedgerFixtures } from '../fixtures-compliance-ledger.mjs';

export function createComplianceLedgerPublicRoutes(basePath = '/public/compliance-ledger') {
  const snapshot = buildComplianceLedgerSnapshot();
  const fixtures = createComplianceLedgerFixtures();
  return [
    { id: 'compliance-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

