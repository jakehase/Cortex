import { buildLifecycleWatchtowerSnapshot } from '../service-lifecycle-watchtower.mjs';
import { createLifecycleWatchtowerFixtures } from '../fixtures-lifecycle-watchtower.mjs';

export function createLifecycleWatchtowerPublicRoutes(basePath = '/public/lifecycle-watchtower') {
  const snapshot = buildLifecycleWatchtowerSnapshot();
  const fixtures = createLifecycleWatchtowerFixtures();
  return [
    { id: 'lifecycle-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

