import { buildAdvocacyWorkbenchSnapshot } from '../service-advocacy-workbench.mjs';
import { createAdvocacyWorkbenchFixtures } from '../fixtures-advocacy-workbench.mjs';

export function createAdvocacyWorkbenchPublicRoutes(basePath = '/public/advocacy-workbench') {
  const snapshot = buildAdvocacyWorkbenchSnapshot();
  const fixtures = createAdvocacyWorkbenchFixtures();
  return [
    { id: 'advocacy-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

