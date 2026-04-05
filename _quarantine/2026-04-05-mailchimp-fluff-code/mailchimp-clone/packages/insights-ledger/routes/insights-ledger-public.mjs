import { buildInsightsLedgerSnapshot } from '../service-insights-ledger.mjs';
import { createInsightsLedgerFixtures } from '../fixtures-insights-ledger.mjs';

export function createInsightsLedgerPublicRoutes(basePath = '/public/insights-ledger') {
  const snapshot = buildInsightsLedgerSnapshot();
  const fixtures = createInsightsLedgerFixtures();
  return [
    { id: 'insights-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

