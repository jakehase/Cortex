import { buildLifecycleIndexSnapshot } from '../service-lifecycle-index.mjs';
import { createLifecycleIndexFixtures } from '../fixtures-lifecycle-index.mjs';

export function createLifecycleIndexPublicRoutes(basePath = '/public/lifecycle-index') {
  const snapshot = buildLifecycleIndexSnapshot();
  const fixtures = createLifecycleIndexFixtures();
  return [
    { id: 'lifecycle-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

