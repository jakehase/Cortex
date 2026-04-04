import { buildLoyaltyAtlasSnapshot } from '../service-loyalty-atlas.mjs';
import { createLoyaltyAtlasFixtures } from '../fixtures-loyalty-atlas.mjs';

export function createLoyaltyAtlasPublicRoutes(basePath = '/public/loyalty-atlas') {
  const snapshot = buildLoyaltyAtlasSnapshot();
  const fixtures = createLoyaltyAtlasFixtures();
  return [
    { id: 'loyalty-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

