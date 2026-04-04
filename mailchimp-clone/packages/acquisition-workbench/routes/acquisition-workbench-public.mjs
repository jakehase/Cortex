import { buildAcquisitionWorkbenchSnapshot } from '../service-acquisition-workbench.mjs';
import { createAcquisitionWorkbenchFixtures } from '../fixtures-acquisition-workbench.mjs';

export function createAcquisitionWorkbenchPublicRoutes(basePath = '/public/acquisition-workbench') {
  const snapshot = buildAcquisitionWorkbenchSnapshot();
  const fixtures = createAcquisitionWorkbenchFixtures();
  return [
    { id: 'acquisition-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

