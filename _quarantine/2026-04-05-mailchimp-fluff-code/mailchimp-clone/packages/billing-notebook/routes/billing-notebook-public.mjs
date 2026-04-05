import { buildBillingNotebookSnapshot } from '../service-billing-notebook.mjs';
import { createBillingNotebookFixtures } from '../fixtures-billing-notebook.mjs';

export function createBillingNotebookPublicRoutes(basePath = '/public/billing-notebook') {
  const snapshot = buildBillingNotebookSnapshot();
  const fixtures = createBillingNotebookFixtures();
  return [
    { id: 'billing-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

