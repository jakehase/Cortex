import { buildCreativeWorkbenchSnapshot } from '../service-creative-workbench.mjs';
import { createCreativeWorkbenchFixtures } from '../fixtures-creative-workbench.mjs';

export function createCreativeWorkbenchPublicRoutes(basePath = '/public/creative-workbench') {
  const snapshot = buildCreativeWorkbenchSnapshot();
  const fixtures = createCreativeWorkbenchFixtures();
  return [
    { id: 'creative-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

