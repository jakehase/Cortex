import { buildDataAtlasSnapshot } from '../service-data-atlas.mjs';
import { createDataAtlasFixtures } from '../fixtures-data-atlas.mjs';

export function createDataAtlasPublicRoutes(basePath = '/public/data-atlas') {
  const snapshot = buildDataAtlasSnapshot();
  const fixtures = createDataAtlasFixtures();
  return [
    { id: 'data-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

