import { buildAudienceAtlasSnapshot } from '../service-audience-atlas.mjs';
import { createAudienceAtlasFixtures } from '../fixtures-audience-atlas.mjs';

export function createAudienceAtlasPublicRoutes(basePath = '/public/audience-atlas') {
  const snapshot = buildAudienceAtlasSnapshot();
  const fixtures = createAudienceAtlasFixtures();
  return [
    { id: 'audience-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

