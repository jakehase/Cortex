import { buildEcommerceNotebookSnapshot } from '../service-ecommerce-notebook.mjs';
import { createEcommerceNotebookFixtures } from '../fixtures-ecommerce-notebook.mjs';

export function createEcommerceNotebookPublicRoutes(basePath = '/public/ecommerce-notebook') {
  const snapshot = buildEcommerceNotebookSnapshot();
  const fixtures = createEcommerceNotebookFixtures();
  return [
    { id: 'ecommerce-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

