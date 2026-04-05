import { buildLifecycleNotebookSnapshot } from '../service-lifecycle-notebook.mjs';
import { createLifecycleNotebookFixtures } from '../fixtures-lifecycle-notebook.mjs';

export function createLifecycleNotebookPublicRoutes(basePath = '/public/lifecycle-notebook') {
  const snapshot = buildLifecycleNotebookSnapshot();
  const fixtures = createLifecycleNotebookFixtures();
  return [
    { id: 'lifecycle-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

