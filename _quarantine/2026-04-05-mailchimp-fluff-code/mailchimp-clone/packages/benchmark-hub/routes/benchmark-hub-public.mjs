import { buildBenchmarkHubSnapshot } from '../service-benchmark-hub.mjs';
import { createBenchmarkHubFixtures } from '../fixtures-benchmark-hub.mjs';

export function createBenchmarkHubPublicRoutes(basePath = '/public/benchmark-hub') {
  const snapshot = buildBenchmarkHubSnapshot();
  const fixtures = createBenchmarkHubFixtures();
  return [
    { id: 'benchmark-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

