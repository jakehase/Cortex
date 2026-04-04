import { buildAcquisitionWatchtowerSnapshot } from '../service-acquisition-watchtower.mjs';
import { createAcquisitionWatchtowerFixtures } from '../fixtures-acquisition-watchtower.mjs';

export function createAcquisitionWatchtowerPublicRoutes(basePath = '/public/acquisition-watchtower') {
  const snapshot = buildAcquisitionWatchtowerSnapshot();
  const fixtures = createAcquisitionWatchtowerFixtures();
  return [
    { id: 'acquisition-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

