import { buildAttributionConsoleSnapshot } from '../service-attribution-console.mjs';
import { createAttributionConsoleFixtures } from '../fixtures-attribution-console.mjs';

export function createAttributionConsolePublicRoutes(basePath = '/public/attribution-console') {
  const snapshot = buildAttributionConsoleSnapshot();
  const fixtures = createAttributionConsoleFixtures();
  return [
    { id: 'attribution-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

