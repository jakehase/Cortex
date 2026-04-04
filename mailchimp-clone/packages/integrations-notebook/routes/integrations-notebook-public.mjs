import { buildIntegrationsNotebookSnapshot } from '../service-integrations-notebook.mjs';
import { createIntegrationsNotebookFixtures } from '../fixtures-integrations-notebook.mjs';

export function createIntegrationsNotebookPublicRoutes(basePath = '/public/integrations-notebook') {
  const snapshot = buildIntegrationsNotebookSnapshot();
  const fixtures = createIntegrationsNotebookFixtures();
  return [
    { id: 'integrations-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

