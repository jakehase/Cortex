import { buildAttributionWorkbenchSnapshot } from '../service-attribution-workbench.mjs';
import { createAttributionWorkbenchFixtures } from '../fixtures-attribution-workbench.mjs';

export function createAttributionWorkbenchPublicRoutes(basePath = '/public/attribution-workbench') {
  const snapshot = buildAttributionWorkbenchSnapshot();
  const fixtures = createAttributionWorkbenchFixtures();
  return [
    { id: 'attribution-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

