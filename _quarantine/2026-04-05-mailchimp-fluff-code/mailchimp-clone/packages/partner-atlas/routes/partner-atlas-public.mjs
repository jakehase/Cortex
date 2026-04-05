import { buildPartnerAtlasSnapshot } from '../service-partner-atlas.mjs';
import { createPartnerAtlasFixtures } from '../fixtures-partner-atlas.mjs';

export function createPartnerAtlasPublicRoutes(basePath = '/public/partner-atlas') {
  const snapshot = buildPartnerAtlasSnapshot();
  const fixtures = createPartnerAtlasFixtures();
  return [
    { id: 'partner-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'partner-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'partner-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

