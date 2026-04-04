import { buildAdvocacyConsoleSnapshot } from '../service-advocacy-console.mjs';
import { createAdvocacyConsoleFixtures } from '../fixtures-advocacy-console.mjs';

export function createAdvocacyConsolePublicRoutes(basePath = '/public/advocacy-console') {
  const snapshot = buildAdvocacyConsoleSnapshot();
  const fixtures = createAdvocacyConsoleFixtures();
  return [
    { id: 'advocacy-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

