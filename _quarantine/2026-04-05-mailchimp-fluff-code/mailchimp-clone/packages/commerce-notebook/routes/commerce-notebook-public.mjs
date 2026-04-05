import { buildCommerceNotebookSnapshot } from '../service-commerce-notebook.mjs';
import { createCommerceNotebookFixtures } from '../fixtures-commerce-notebook.mjs';

export function createCommerceNotebookPublicRoutes(basePath = '/public/commerce-notebook') {
  const snapshot = buildCommerceNotebookSnapshot();
  const fixtures = createCommerceNotebookFixtures();
  return [
    { id: 'commerce-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

