import { buildBenchmarkIndexSnapshot } from '../service-benchmark-index.mjs';
import { createBenchmarkIndexFixtures } from '../fixtures-benchmark-index.mjs';

export function createBenchmarkIndexPublicRoutes(basePath = '/public/benchmark-index') {
  const snapshot = buildBenchmarkIndexSnapshot();
  const fixtures = createBenchmarkIndexFixtures();
  return [
    { id: 'benchmark-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

