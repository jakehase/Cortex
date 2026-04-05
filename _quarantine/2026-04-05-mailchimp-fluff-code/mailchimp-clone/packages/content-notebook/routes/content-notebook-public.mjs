import { buildContentNotebookSnapshot } from '../service-content-notebook.mjs';
import { createContentNotebookFixtures } from '../fixtures-content-notebook.mjs';

export function createContentNotebookPublicRoutes(basePath = '/public/content-notebook') {
  const snapshot = buildContentNotebookSnapshot();
  const fixtures = createContentNotebookFixtures();
  return [
    { id: 'content-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

