import { buildContentAtlasSnapshot } from '../service-content-atlas.mjs';
import { createContentAtlasFixtures } from '../fixtures-content-atlas.mjs';

export function createContentAtlasPublicRoutes(basePath = '/public/content-atlas') {
  const snapshot = buildContentAtlasSnapshot();
  const fixtures = createContentAtlasFixtures();
  return [
    { id: 'content-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

