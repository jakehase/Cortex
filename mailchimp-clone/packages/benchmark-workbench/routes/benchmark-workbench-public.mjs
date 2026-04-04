import { buildBenchmarkWorkbenchSnapshot } from '../service-benchmark-workbench.mjs';
import { createBenchmarkWorkbenchFixtures } from '../fixtures-benchmark-workbench.mjs';

export function createBenchmarkWorkbenchPublicRoutes(basePath = '/public/benchmark-workbench') {
  const snapshot = buildBenchmarkWorkbenchSnapshot();
  const fixtures = createBenchmarkWorkbenchFixtures();
  return [
    { id: 'benchmark-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

