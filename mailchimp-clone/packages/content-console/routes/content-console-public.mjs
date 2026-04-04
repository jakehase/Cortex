import { buildContentConsoleSnapshot } from '../service-content-console.mjs';
import { createContentConsoleFixtures } from '../fixtures-content-console.mjs';

export function createContentConsolePublicRoutes(basePath = '/public/content-console') {
  const snapshot = buildContentConsoleSnapshot();
  const fixtures = createContentConsoleFixtures();
  return [
    { id: 'content-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

