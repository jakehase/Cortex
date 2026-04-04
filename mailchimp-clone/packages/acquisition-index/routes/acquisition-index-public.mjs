import { buildAcquisitionIndexSnapshot } from '../service-acquisition-index.mjs';
import { createAcquisitionIndexFixtures } from '../fixtures-acquisition-index.mjs';

export function createAcquisitionIndexPublicRoutes(basePath = '/public/acquisition-index') {
  const snapshot = buildAcquisitionIndexSnapshot();
  const fixtures = createAcquisitionIndexFixtures();
  return [
    { id: 'acquisition-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

