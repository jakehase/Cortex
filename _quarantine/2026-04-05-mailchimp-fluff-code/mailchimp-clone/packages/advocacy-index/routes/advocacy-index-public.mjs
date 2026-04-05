import { buildAdvocacyIndexSnapshot } from '../service-advocacy-index.mjs';
import { createAdvocacyIndexFixtures } from '../fixtures-advocacy-index.mjs';

export function createAdvocacyIndexPublicRoutes(basePath = '/public/advocacy-index') {
  const snapshot = buildAdvocacyIndexSnapshot();
  const fixtures = createAdvocacyIndexFixtures();
  return [
    { id: 'advocacy-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

