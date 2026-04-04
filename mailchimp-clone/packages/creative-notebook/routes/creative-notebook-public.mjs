import { buildCreativeNotebookSnapshot } from '../service-creative-notebook.mjs';
import { createCreativeNotebookFixtures } from '../fixtures-creative-notebook.mjs';

export function createCreativeNotebookPublicRoutes(basePath = '/public/creative-notebook') {
  const snapshot = buildCreativeNotebookSnapshot();
  const fixtures = createCreativeNotebookFixtures();
  return [
    { id: 'creative-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

