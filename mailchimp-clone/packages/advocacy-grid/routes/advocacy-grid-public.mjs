import { buildAdvocacyGridSnapshot } from '../service-advocacy-grid.mjs';
import { createAdvocacyGridFixtures } from '../fixtures-advocacy-grid.mjs';

export function createAdvocacyGridPublicRoutes(basePath = '/public/advocacy-grid') {
  const snapshot = buildAdvocacyGridSnapshot();
  const fixtures = createAdvocacyGridFixtures();
  return [
    { id: 'advocacy-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

