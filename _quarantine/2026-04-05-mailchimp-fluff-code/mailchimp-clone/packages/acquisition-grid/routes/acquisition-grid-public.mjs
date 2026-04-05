import { buildAcquisitionGridSnapshot } from '../service-acquisition-grid.mjs';
import { createAcquisitionGridFixtures } from '../fixtures-acquisition-grid.mjs';

export function createAcquisitionGridPublicRoutes(basePath = '/public/acquisition-grid') {
  const snapshot = buildAcquisitionGridSnapshot();
  const fixtures = createAcquisitionGridFixtures();
  return [
    { id: 'acquisition-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

