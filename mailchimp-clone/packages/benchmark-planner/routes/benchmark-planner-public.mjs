import { buildBenchmarkPlannerSnapshot } from '../service-benchmark-planner.mjs';
import { createBenchmarkPlannerFixtures } from '../fixtures-benchmark-planner.mjs';

export function createBenchmarkPlannerPublicRoutes(basePath = '/public/benchmark-planner') {
  const snapshot = buildBenchmarkPlannerSnapshot();
  const fixtures = createBenchmarkPlannerFixtures();
  return [
    { id: 'benchmark-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

