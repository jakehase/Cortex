import { buildAttributionNotebookSnapshot } from '../service-attribution-notebook.mjs';
import { createAttributionNotebookFixtures } from '../fixtures-attribution-notebook.mjs';

export function createAttributionNotebookPublicRoutes(basePath = '/public/attribution-notebook') {
  const snapshot = buildAttributionNotebookSnapshot();
  const fixtures = createAttributionNotebookFixtures();
  return [
    { id: 'attribution-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

