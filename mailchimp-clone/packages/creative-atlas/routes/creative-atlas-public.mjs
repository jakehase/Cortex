import { buildCreativeAtlasSnapshot } from '../service-creative-atlas.mjs';
import { createCreativeAtlasFixtures } from '../fixtures-creative-atlas.mjs';

export function createCreativeAtlasPublicRoutes(basePath = '/public/creative-atlas') {
  const snapshot = buildCreativeAtlasSnapshot();
  const fixtures = createCreativeAtlasFixtures();
  return [
    { id: 'creative-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

