import { buildBenchmarkNotebookSnapshot } from '../service-benchmark-notebook.mjs';
import { createBenchmarkNotebookFixtures } from '../fixtures-benchmark-notebook.mjs';

export function createBenchmarkNotebookPublicRoutes(basePath = '/public/benchmark-notebook') {
  const snapshot = buildBenchmarkNotebookSnapshot();
  const fixtures = createBenchmarkNotebookFixtures();
  return [
    { id: 'benchmark-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

