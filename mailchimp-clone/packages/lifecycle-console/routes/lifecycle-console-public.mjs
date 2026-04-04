import { buildLifecycleConsoleSnapshot } from '../service-lifecycle-console.mjs';
import { createLifecycleConsoleFixtures } from '../fixtures-lifecycle-console.mjs';

export function createLifecycleConsolePublicRoutes(basePath = '/public/lifecycle-console') {
  const snapshot = buildLifecycleConsoleSnapshot();
  const fixtures = createLifecycleConsoleFixtures();
  return [
    { id: 'lifecycle-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

