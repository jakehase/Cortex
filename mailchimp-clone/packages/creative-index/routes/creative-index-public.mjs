import { buildCreativeIndexSnapshot } from '../service-creative-index.mjs';
import { createCreativeIndexFixtures } from '../fixtures-creative-index.mjs';

export function createCreativeIndexPublicRoutes(basePath = '/public/creative-index') {
  const snapshot = buildCreativeIndexSnapshot();
  const fixtures = createCreativeIndexFixtures();
  return [
    { id: 'creative-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

