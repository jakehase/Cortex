import { buildCollaborationGridSnapshot } from '../service-collaboration-grid.mjs';
import { createCollaborationGridFixtures } from '../fixtures-collaboration-grid.mjs';

export function createCollaborationGridPublicRoutes(basePath = '/public/collaboration-grid') {
  const snapshot = buildCollaborationGridSnapshot();
  const fixtures = createCollaborationGridFixtures();
  return [
    { id: 'collaboration-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

