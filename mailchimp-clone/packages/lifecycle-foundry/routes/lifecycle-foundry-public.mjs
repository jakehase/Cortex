import { buildLifecycleFoundrySnapshot } from '../service-lifecycle-foundry.mjs';
import { createLifecycleFoundryFixtures } from '../fixtures-lifecycle-foundry.mjs';

export function createLifecycleFoundryPublicRoutes(basePath = '/public/lifecycle-foundry') {
  const snapshot = buildLifecycleFoundrySnapshot();
  const fixtures = createLifecycleFoundryFixtures();
  return [
    { id: 'lifecycle-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

