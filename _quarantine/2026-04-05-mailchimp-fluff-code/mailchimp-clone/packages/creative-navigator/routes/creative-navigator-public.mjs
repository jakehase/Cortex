import { buildCreativeNavigatorSnapshot } from '../service-creative-navigator.mjs';
import { createCreativeNavigatorFixtures } from '../fixtures-creative-navigator.mjs';

export function createCreativeNavigatorPublicRoutes(basePath = '/public/creative-navigator') {
  const snapshot = buildCreativeNavigatorSnapshot();
  const fixtures = createCreativeNavigatorFixtures();
  return [
    { id: 'creative-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

