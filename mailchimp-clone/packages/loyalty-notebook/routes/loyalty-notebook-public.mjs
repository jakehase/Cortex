import { buildLoyaltyNotebookSnapshot } from '../service-loyalty-notebook.mjs';
import { createLoyaltyNotebookFixtures } from '../fixtures-loyalty-notebook.mjs';

export function createLoyaltyNotebookPublicRoutes(basePath = '/public/loyalty-notebook') {
  const snapshot = buildLoyaltyNotebookSnapshot();
  const fixtures = createLoyaltyNotebookFixtures();
  return [
    { id: 'loyalty-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

