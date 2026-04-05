import { buildCollaborationConsoleSnapshot } from '../service-collaboration-console.mjs';
import { createCollaborationConsoleFixtures } from '../fixtures-collaboration-console.mjs';

export function createCollaborationConsolePublicRoutes(basePath = '/public/collaboration-console') {
  const snapshot = buildCollaborationConsoleSnapshot();
  const fixtures = createCollaborationConsoleFixtures();
  return [
    { id: 'collaboration-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

