import { buildCreativeConsoleSnapshot } from '../service-creative-console.mjs';
import { createCreativeConsoleFixtures } from '../fixtures-creative-console.mjs';

export function createCreativeConsolePublicRoutes(basePath = '/public/creative-console') {
  const snapshot = buildCreativeConsoleSnapshot();
  const fixtures = createCreativeConsoleFixtures();
  return [
    { id: 'creative-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

