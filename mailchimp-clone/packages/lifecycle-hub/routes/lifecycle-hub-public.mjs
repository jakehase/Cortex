import { buildLifecycleHubSnapshot } from '../service-lifecycle-hub.mjs';
import { createLifecycleHubFixtures } from '../fixtures-lifecycle-hub.mjs';

export function createLifecycleHubPublicRoutes(basePath = '/public/lifecycle-hub') {
  const snapshot = buildLifecycleHubSnapshot();
  const fixtures = createLifecycleHubFixtures();
  return [
    { id: 'lifecycle-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

