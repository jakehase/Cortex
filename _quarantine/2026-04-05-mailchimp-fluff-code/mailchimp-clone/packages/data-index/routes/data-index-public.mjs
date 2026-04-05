import { buildDataIndexSnapshot } from '../service-data-index.mjs';
import { createDataIndexFixtures } from '../fixtures-data-index.mjs';

export function createDataIndexPublicRoutes(basePath = '/public/data-index') {
  const snapshot = buildDataIndexSnapshot();
  const fixtures = createDataIndexFixtures();
  return [
    { id: 'data-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

