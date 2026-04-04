import { buildContentWatchtowerSnapshot } from '../service-content-watchtower.mjs';
import { createContentWatchtowerFixtures } from '../fixtures-content-watchtower.mjs';

export function createContentWatchtowerPublicRoutes(basePath = '/public/content-watchtower') {
  const snapshot = buildContentWatchtowerSnapshot();
  const fixtures = createContentWatchtowerFixtures();
  return [
    { id: 'content-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

