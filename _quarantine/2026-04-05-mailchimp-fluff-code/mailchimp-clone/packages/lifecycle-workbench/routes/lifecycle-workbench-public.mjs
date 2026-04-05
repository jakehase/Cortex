import { buildLifecycleWorkbenchSnapshot } from '../service-lifecycle-workbench.mjs';
import { createLifecycleWorkbenchFixtures } from '../fixtures-lifecycle-workbench.mjs';

export function createLifecycleWorkbenchPublicRoutes(basePath = '/public/lifecycle-workbench') {
  const snapshot = buildLifecycleWorkbenchSnapshot();
  const fixtures = createLifecycleWorkbenchFixtures();
  return [
    { id: 'lifecycle-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

