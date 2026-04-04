import { buildAudienceIndexSnapshot } from '../service-audience-index.mjs';
import { createAudienceIndexFixtures } from '../fixtures-audience-index.mjs';

export function createAudienceIndexPublicRoutes(basePath = '/public/audience-index') {
  const snapshot = buildAudienceIndexSnapshot();
  const fixtures = createAudienceIndexFixtures();
  return [
    { id: 'audience-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

