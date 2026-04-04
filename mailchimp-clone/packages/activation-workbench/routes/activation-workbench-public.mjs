import { buildActivationWorkbenchSnapshot } from '../service-activation-workbench.mjs';
import { createActivationWorkbenchFixtures } from '../fixtures-activation-workbench.mjs';

export function createActivationWorkbenchPublicRoutes(basePath = '/public/activation-workbench') {
  const snapshot = buildActivationWorkbenchSnapshot();
  const fixtures = createActivationWorkbenchFixtures();
  return [
    { id: 'activation-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

