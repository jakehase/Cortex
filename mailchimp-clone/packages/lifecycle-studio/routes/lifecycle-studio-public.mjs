import { buildLifecycleStudioSnapshot } from '../service-lifecycle-studio.mjs';
import { createLifecycleStudioFixtures } from '../fixtures-lifecycle-studio.mjs';

export function createLifecycleStudioPublicRoutes(basePath = '/public/lifecycle-studio') {
  const snapshot = buildLifecycleStudioSnapshot();
  const fixtures = createLifecycleStudioFixtures();
  return [
    { id: 'lifecycle-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

