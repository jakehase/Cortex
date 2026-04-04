import { buildDataNavigatorSnapshot } from '../service-data-navigator.mjs';
import { createDataNavigatorFixtures } from '../fixtures-data-navigator.mjs';

export function createDataNavigatorPublicRoutes(basePath = '/public/data-navigator') {
  const snapshot = buildDataNavigatorSnapshot();
  const fixtures = createDataNavigatorFixtures();
  return [
    { id: 'data-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

