import { buildDataNotebookSnapshot } from '../service-data-notebook.mjs';
import { createDataNotebookFixtures } from '../fixtures-data-notebook.mjs';

export function createDataNotebookPublicRoutes(basePath = '/public/data-notebook') {
  const snapshot = buildDataNotebookSnapshot();
  const fixtures = createDataNotebookFixtures();
  return [
    { id: 'data-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

