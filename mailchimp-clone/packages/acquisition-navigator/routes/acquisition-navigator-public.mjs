import { buildAcquisitionNavigatorSnapshot } from '../service-acquisition-navigator.mjs';
import { createAcquisitionNavigatorFixtures } from '../fixtures-acquisition-navigator.mjs';

export function createAcquisitionNavigatorPublicRoutes(basePath = '/public/acquisition-navigator') {
  const snapshot = buildAcquisitionNavigatorSnapshot();
  const fixtures = createAcquisitionNavigatorFixtures();
  return [
    { id: 'acquisition-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

