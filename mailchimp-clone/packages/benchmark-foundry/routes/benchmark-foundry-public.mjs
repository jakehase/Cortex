import { buildBenchmarkFoundrySnapshot } from '../service-benchmark-foundry.mjs';
import { createBenchmarkFoundryFixtures } from '../fixtures-benchmark-foundry.mjs';

export function createBenchmarkFoundryPublicRoutes(basePath = '/public/benchmark-foundry') {
  const snapshot = buildBenchmarkFoundrySnapshot();
  const fixtures = createBenchmarkFoundryFixtures();
  return [
    { id: 'benchmark-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

