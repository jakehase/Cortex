import { buildAudienceWatchtowerSnapshot } from '../service-audience-watchtower.mjs';
import { createAudienceWatchtowerFixtures } from '../fixtures-audience-watchtower.mjs';

export function createAudienceWatchtowerPublicRoutes(basePath = '/public/audience-watchtower') {
  const snapshot = buildAudienceWatchtowerSnapshot();
  const fixtures = createAudienceWatchtowerFixtures();
  return [
    { id: 'audience-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

