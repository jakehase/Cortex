import { buildAttributionAtlasSnapshot } from '../service-attribution-atlas.mjs';
import { createAttributionAtlasFixtures } from '../fixtures-attribution-atlas.mjs';

export function createAttributionAtlasPublicRoutes(basePath = '/public/attribution-atlas') {
  const snapshot = buildAttributionAtlasSnapshot();
  const fixtures = createAttributionAtlasFixtures();
  return [
    { id: 'attribution-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

