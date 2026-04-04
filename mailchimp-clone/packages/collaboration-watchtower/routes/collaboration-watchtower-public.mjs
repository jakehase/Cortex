import { buildCollaborationWatchtowerSnapshot } from '../service-collaboration-watchtower.mjs';
import { createCollaborationWatchtowerFixtures } from '../fixtures-collaboration-watchtower.mjs';

export function createCollaborationWatchtowerPublicRoutes(basePath = '/public/collaboration-watchtower') {
  const snapshot = buildCollaborationWatchtowerSnapshot();
  const fixtures = createCollaborationWatchtowerFixtures();
  return [
    { id: 'collaboration-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

