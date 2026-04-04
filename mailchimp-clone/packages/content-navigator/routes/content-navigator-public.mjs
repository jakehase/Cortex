import { buildContentNavigatorSnapshot } from '../service-content-navigator.mjs';
import { createContentNavigatorFixtures } from '../fixtures-content-navigator.mjs';

export function createContentNavigatorPublicRoutes(basePath = '/public/content-navigator') {
  const snapshot = buildContentNavigatorSnapshot();
  const fixtures = createContentNavigatorFixtures();
  return [
    { id: 'content-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

