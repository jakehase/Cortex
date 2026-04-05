import { buildAttributionWatchtowerSnapshot } from '../service-attribution-watchtower.mjs';
import { createAttributionWatchtowerFixtures } from '../fixtures-attribution-watchtower.mjs';

export function createAttributionWatchtowerPublicRoutes(basePath = '/public/attribution-watchtower') {
  const snapshot = buildAttributionWatchtowerSnapshot();
  const fixtures = createAttributionWatchtowerFixtures();
  return [
    { id: 'attribution-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

