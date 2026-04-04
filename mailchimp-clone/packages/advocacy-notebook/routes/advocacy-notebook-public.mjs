import { buildAdvocacyNotebookSnapshot } from '../service-advocacy-notebook.mjs';
import { createAdvocacyNotebookFixtures } from '../fixtures-advocacy-notebook.mjs';

export function createAdvocacyNotebookPublicRoutes(basePath = '/public/advocacy-notebook') {
  const snapshot = buildAdvocacyNotebookSnapshot();
  const fixtures = createAdvocacyNotebookFixtures();
  return [
    { id: 'advocacy-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

