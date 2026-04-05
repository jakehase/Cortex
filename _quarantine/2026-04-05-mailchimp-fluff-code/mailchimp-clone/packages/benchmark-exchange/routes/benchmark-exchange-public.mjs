import { buildBenchmarkExchangeSnapshot } from '../service-benchmark-exchange.mjs';
import { createBenchmarkExchangeFixtures } from '../fixtures-benchmark-exchange.mjs';

export function createBenchmarkExchangePublicRoutes(basePath = '/public/benchmark-exchange') {
  const snapshot = buildBenchmarkExchangeSnapshot();
  const fixtures = createBenchmarkExchangeFixtures();
  return [
    { id: 'benchmark-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

