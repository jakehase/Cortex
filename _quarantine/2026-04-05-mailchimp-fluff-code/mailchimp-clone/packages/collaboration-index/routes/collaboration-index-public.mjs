import { buildCollaborationIndexSnapshot } from '../service-collaboration-index.mjs';
import { createCollaborationIndexFixtures } from '../fixtures-collaboration-index.mjs';

export function createCollaborationIndexPublicRoutes(basePath = '/public/collaboration-index') {
  const snapshot = buildCollaborationIndexSnapshot();
  const fixtures = createCollaborationIndexFixtures();
  return [
    { id: 'collaboration-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

