import { buildAnalyticsLedgerSnapshot } from '../service-analytics-ledger.mjs';
import { createAnalyticsLedgerFixtures } from '../fixtures-analytics-ledger.mjs';

export function createAnalyticsLedgerPublicRoutes(basePath = '/public/analytics-ledger') {
  const snapshot = buildAnalyticsLedgerSnapshot();
  const fixtures = createAnalyticsLedgerFixtures();
  return [
    { id: 'analytics-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

