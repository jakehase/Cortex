import { buildAdvocacyNavigatorSnapshot } from '../service-advocacy-navigator.mjs';
import { createAdvocacyNavigatorFixtures } from '../fixtures-advocacy-navigator.mjs';

export function createAdvocacyNavigatorPublicRoutes(basePath = '/public/advocacy-navigator') {
  const snapshot = buildAdvocacyNavigatorSnapshot();
  const fixtures = createAdvocacyNavigatorFixtures();
  return [
    { id: 'advocacy-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

