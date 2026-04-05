import { buildConsentAtlasSnapshot } from '../service-consent-atlas.mjs';
import { createConsentAtlasFixtures } from '../fixtures-consent-atlas.mjs';

export function createConsentAtlasPublicRoutes(basePath = '/public/consent-atlas') {
  const snapshot = buildConsentAtlasSnapshot();
  const fixtures = createConsentAtlasFixtures();
  return [
    { id: 'consent-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

