import { buildCreativeWatchtowerSnapshot } from '../service-creative-watchtower.mjs';
import { createCreativeWatchtowerFixtures } from '../fixtures-creative-watchtower.mjs';

export function createCreativeWatchtowerPublicRoutes(basePath = '/public/creative-watchtower') {
  const snapshot = buildCreativeWatchtowerSnapshot();
  const fixtures = createCreativeWatchtowerFixtures();
  return [
    { id: 'creative-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

