import { buildCollaborationWorkbenchSnapshot } from '../service-collaboration-workbench.mjs';
import { createCollaborationWorkbenchFixtures } from '../fixtures-collaboration-workbench.mjs';

export function createCollaborationWorkbenchPublicRoutes(basePath = '/public/collaboration-workbench') {
  const snapshot = buildCollaborationWorkbenchSnapshot();
  const fixtures = createCollaborationWorkbenchFixtures();
  return [
    { id: 'collaboration-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

