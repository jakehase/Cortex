import { buildAutomationNotebookSnapshot } from '../service-automation-notebook.mjs';
import { createAutomationNotebookFixtures } from '../fixtures-automation-notebook.mjs';

export function createAutomationNotebookPublicRoutes(basePath = '/public/automation-notebook') {
  const snapshot = buildAutomationNotebookSnapshot();
  const fixtures = createAutomationNotebookFixtures();
  return [
    { id: 'automation-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

