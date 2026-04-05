import { buildContentWorkbenchSnapshot } from '../service-content-workbench.mjs';
import { createContentWorkbenchFixtures } from '../fixtures-content-workbench.mjs';

export function createContentWorkbenchPublicRoutes(basePath = '/public/content-workbench') {
  const snapshot = buildContentWorkbenchSnapshot();
  const fixtures = createContentWorkbenchFixtures();
  return [
    { id: 'content-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

