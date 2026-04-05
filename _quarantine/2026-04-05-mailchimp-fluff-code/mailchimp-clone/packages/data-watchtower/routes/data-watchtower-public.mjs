import { buildDataWatchtowerSnapshot } from '../service-data-watchtower.mjs';
import { createDataWatchtowerFixtures } from '../fixtures-data-watchtower.mjs';

export function createDataWatchtowerPublicRoutes(basePath = '/public/data-watchtower') {
  const snapshot = buildDataWatchtowerSnapshot();
  const fixtures = createDataWatchtowerFixtures();
  return [
    { id: 'data-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

