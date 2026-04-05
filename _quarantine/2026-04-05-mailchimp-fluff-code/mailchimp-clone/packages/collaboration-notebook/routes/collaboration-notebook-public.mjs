import { buildCollaborationNotebookSnapshot } from '../service-collaboration-notebook.mjs';
import { createCollaborationNotebookFixtures } from '../fixtures-collaboration-notebook.mjs';

export function createCollaborationNotebookPublicRoutes(basePath = '/public/collaboration-notebook') {
  const snapshot = buildCollaborationNotebookSnapshot();
  const fixtures = createCollaborationNotebookFixtures();
  return [
    { id: 'collaboration-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

