import { buildLocalizationAtlasSnapshot } from '../service-localization-atlas.mjs';
import { createLocalizationAtlasFixtures } from '../fixtures-localization-atlas.mjs';

export function createLocalizationAtlasPublicRoutes(basePath = '/public/localization-atlas') {
  const snapshot = buildLocalizationAtlasSnapshot();
  const fixtures = createLocalizationAtlasFixtures();
  return [
    { id: 'localization-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

