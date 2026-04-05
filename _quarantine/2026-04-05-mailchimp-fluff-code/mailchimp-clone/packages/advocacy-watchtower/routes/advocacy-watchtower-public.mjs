import { buildAdvocacyWatchtowerSnapshot } from '../service-advocacy-watchtower.mjs';
import { createAdvocacyWatchtowerFixtures } from '../fixtures-advocacy-watchtower.mjs';

export function createAdvocacyWatchtowerPublicRoutes(basePath = '/public/advocacy-watchtower') {
  const snapshot = buildAdvocacyWatchtowerSnapshot();
  const fixtures = createAdvocacyWatchtowerFixtures();
  return [
    { id: 'advocacy-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

