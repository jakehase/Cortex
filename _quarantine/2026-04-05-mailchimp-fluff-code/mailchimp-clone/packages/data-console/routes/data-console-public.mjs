import { buildDataConsoleSnapshot } from '../service-data-console.mjs';
import { createDataConsoleFixtures } from '../fixtures-data-console.mjs';

export function createDataConsolePublicRoutes(basePath = '/public/data-console') {
  const snapshot = buildDataConsoleSnapshot();
  const fixtures = createDataConsoleFixtures();
  return [
    { id: 'data-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

