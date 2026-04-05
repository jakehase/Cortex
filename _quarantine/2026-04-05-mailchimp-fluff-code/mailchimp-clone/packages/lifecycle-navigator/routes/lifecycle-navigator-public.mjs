import { buildLifecycleNavigatorSnapshot } from '../service-lifecycle-navigator.mjs';
import { createLifecycleNavigatorFixtures } from '../fixtures-lifecycle-navigator.mjs';

export function createLifecycleNavigatorPublicRoutes(basePath = '/public/lifecycle-navigator') {
  const snapshot = buildLifecycleNavigatorSnapshot();
  const fixtures = createLifecycleNavigatorFixtures();
  return [
    { id: 'lifecycle-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

