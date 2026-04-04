import { buildCollaborationNavigatorSnapshot } from '../service-collaboration-navigator.mjs';
import { createCollaborationNavigatorFixtures } from '../fixtures-collaboration-navigator.mjs';

export function createCollaborationNavigatorPublicRoutes(basePath = '/public/collaboration-navigator') {
  const snapshot = buildCollaborationNavigatorSnapshot();
  const fixtures = createCollaborationNavigatorFixtures();
  return [
    { id: 'collaboration-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

