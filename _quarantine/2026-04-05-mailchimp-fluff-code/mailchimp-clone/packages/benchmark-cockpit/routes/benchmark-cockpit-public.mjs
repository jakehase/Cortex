import { buildBenchmarkCockpitSnapshot } from '../service-benchmark-cockpit.mjs';
import { createBenchmarkCockpitFixtures } from '../fixtures-benchmark-cockpit.mjs';

export function createBenchmarkCockpitPublicRoutes(basePath = '/public/benchmark-cockpit') {
  const snapshot = buildBenchmarkCockpitSnapshot();
  const fixtures = createBenchmarkCockpitFixtures();
  return [
    { id: 'benchmark-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

