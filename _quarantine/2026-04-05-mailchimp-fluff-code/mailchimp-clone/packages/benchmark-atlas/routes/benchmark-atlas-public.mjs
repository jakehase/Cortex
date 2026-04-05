import { buildBenchmarkAtlasSnapshot } from '../service-benchmark-atlas.mjs';
import { createBenchmarkAtlasFixtures } from '../fixtures-benchmark-atlas.mjs';

export function createBenchmarkAtlasPublicRoutes(basePath = '/public/benchmark-atlas') {
  const snapshot = buildBenchmarkAtlasSnapshot();
  const fixtures = createBenchmarkAtlasFixtures();
  return [
    { id: 'benchmark-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

