import { buildBenchmarkLedgerSnapshot } from '../service-benchmark-ledger.mjs';
import { createBenchmarkLedgerFixtures } from '../fixtures-benchmark-ledger.mjs';

export function createBenchmarkLedgerPublicRoutes(basePath = '/public/benchmark-ledger') {
  const snapshot = buildBenchmarkLedgerSnapshot();
  const fixtures = createBenchmarkLedgerFixtures();
  return [
    { id: 'benchmark-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

