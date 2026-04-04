import { buildContentIndexSnapshot } from '../service-content-index.mjs';
import { createContentIndexFixtures } from '../fixtures-content-index.mjs';

export function createContentIndexPublicRoutes(basePath = '/public/content-index') {
  const snapshot = buildContentIndexSnapshot();
  const fixtures = createContentIndexFixtures();
  return [
    { id: 'content-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

