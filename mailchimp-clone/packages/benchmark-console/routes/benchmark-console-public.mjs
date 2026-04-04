import { buildBenchmarkConsoleSnapshot } from '../service-benchmark-console.mjs';
import { createBenchmarkConsoleFixtures } from '../fixtures-benchmark-console.mjs';

export function createBenchmarkConsolePublicRoutes(basePath = '/public/benchmark-console') {
  const snapshot = buildBenchmarkConsoleSnapshot();
  const fixtures = createBenchmarkConsoleFixtures();
  return [
    { id: 'benchmark-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

