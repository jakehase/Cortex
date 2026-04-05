import { buildContentGridSnapshot } from '../service-content-grid.mjs';
import { createContentGridFixtures } from '../fixtures-content-grid.mjs';

export function createContentGridPublicRoutes(basePath = '/public/content-grid') {
  const snapshot = buildContentGridSnapshot();
  const fixtures = createContentGridFixtures();
  return [
    { id: 'content-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

