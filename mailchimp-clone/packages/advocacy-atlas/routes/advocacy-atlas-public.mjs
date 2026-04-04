import { buildAdvocacyAtlasSnapshot } from '../service-advocacy-atlas.mjs';
import { createAdvocacyAtlasFixtures } from '../fixtures-advocacy-atlas.mjs';

export function createAdvocacyAtlasPublicRoutes(basePath = '/public/advocacy-atlas') {
  const snapshot = buildAdvocacyAtlasSnapshot();
  const fixtures = createAdvocacyAtlasFixtures();
  return [
    { id: 'advocacy-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

