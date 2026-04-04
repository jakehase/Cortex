import { buildCreativeGridSnapshot } from '../service-creative-grid.mjs';
import { createCreativeGridFixtures } from '../fixtures-creative-grid.mjs';

export function createCreativeGridPublicRoutes(basePath = '/public/creative-grid') {
  const snapshot = buildCreativeGridSnapshot();
  const fixtures = createCreativeGridFixtures();
  return [
    { id: 'creative-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

