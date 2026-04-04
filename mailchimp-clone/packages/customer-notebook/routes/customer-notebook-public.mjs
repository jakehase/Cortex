import { buildCustomerNotebookSnapshot } from '../service-customer-notebook.mjs';
import { createCustomerNotebookFixtures } from '../fixtures-customer-notebook.mjs';

export function createCustomerNotebookPublicRoutes(basePath = '/public/customer-notebook') {
  const snapshot = buildCustomerNotebookSnapshot();
  const fixtures = createCustomerNotebookFixtures();
  return [
    { id: 'customer-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

