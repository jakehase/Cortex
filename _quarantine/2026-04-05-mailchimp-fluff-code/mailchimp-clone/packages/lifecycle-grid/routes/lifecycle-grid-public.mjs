import { buildLifecycleGridSnapshot } from '../service-lifecycle-grid.mjs';
import { createLifecycleGridFixtures } from '../fixtures-lifecycle-grid.mjs';

export function createLifecycleGridPublicRoutes(basePath = '/public/lifecycle-grid') {
  const snapshot = buildLifecycleGridSnapshot();
  const fixtures = createLifecycleGridFixtures();
  return [
    { id: 'lifecycle-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

