import { buildBenchmarkGridSnapshot } from '../service-benchmark-grid.mjs';
import { createBenchmarkGridFixtures } from '../fixtures-benchmark-grid.mjs';

export function createBenchmarkGridPublicRoutes(basePath = '/public/benchmark-grid') {
  const snapshot = buildBenchmarkGridSnapshot();
  const fixtures = createBenchmarkGridFixtures();
  return [
    { id: 'benchmark-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

