import { buildBenchmarkWatchtowerSnapshot } from '../service-benchmark-watchtower.mjs';
import { createBenchmarkWatchtowerFixtures } from '../fixtures-benchmark-watchtower.mjs';

export function createBenchmarkWatchtowerPublicRoutes(basePath = '/public/benchmark-watchtower') {
  const snapshot = buildBenchmarkWatchtowerSnapshot();
  const fixtures = createBenchmarkWatchtowerFixtures();
  return [
    { id: 'benchmark-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

