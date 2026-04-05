import { buildActivationNotebookSnapshot } from '../service-activation-notebook.mjs';
import { createActivationNotebookFixtures } from '../fixtures-activation-notebook.mjs';

export function createActivationNotebookPublicRoutes(basePath = '/public/activation-notebook') {
  const snapshot = buildActivationNotebookSnapshot();
  const fixtures = createActivationNotebookFixtures();
  return [
    { id: 'activation-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

