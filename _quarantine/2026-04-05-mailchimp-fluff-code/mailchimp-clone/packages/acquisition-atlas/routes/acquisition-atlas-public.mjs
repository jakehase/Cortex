import { buildAcquisitionAtlasSnapshot } from '../service-acquisition-atlas.mjs';
import { createAcquisitionAtlasFixtures } from '../fixtures-acquisition-atlas.mjs';

export function createAcquisitionAtlasPublicRoutes(basePath = '/public/acquisition-atlas') {
  const snapshot = buildAcquisitionAtlasSnapshot();
  const fixtures = createAcquisitionAtlasFixtures();
  return [
    { id: 'acquisition-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

