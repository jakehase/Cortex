import { buildBenchmarkNavigatorSnapshot } from '../service-benchmark-navigator.mjs';
import { createBenchmarkNavigatorFixtures } from '../fixtures-benchmark-navigator.mjs';

export function createBenchmarkNavigatorPublicRoutes(basePath = '/public/benchmark-navigator') {
  const snapshot = buildBenchmarkNavigatorSnapshot();
  const fixtures = createBenchmarkNavigatorFixtures();
  return [
    { id: 'benchmark-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

