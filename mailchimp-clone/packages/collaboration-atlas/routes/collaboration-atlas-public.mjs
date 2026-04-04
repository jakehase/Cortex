import { buildCollaborationAtlasSnapshot } from '../service-collaboration-atlas.mjs';
import { createCollaborationAtlasFixtures } from '../fixtures-collaboration-atlas.mjs';

export function createCollaborationAtlasPublicRoutes(basePath = '/public/collaboration-atlas') {
  const snapshot = buildCollaborationAtlasSnapshot();
  const fixtures = createCollaborationAtlasFixtures();
  return [
    { id: 'collaboration-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

