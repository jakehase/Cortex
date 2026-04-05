import { buildDataWorkbenchSnapshot } from '../service-data-workbench.mjs';
import { createDataWorkbenchFixtures } from '../fixtures-data-workbench.mjs';

export function createDataWorkbenchPublicRoutes(basePath = '/public/data-workbench') {
  const snapshot = buildDataWorkbenchSnapshot();
  const fixtures = createDataWorkbenchFixtures();
  return [
    { id: 'data-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

