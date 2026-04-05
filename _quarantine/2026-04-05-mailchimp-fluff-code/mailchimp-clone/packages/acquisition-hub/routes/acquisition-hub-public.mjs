import { buildAcquisitionHubSnapshot } from '../service-acquisition-hub.mjs';
import { createAcquisitionHubFixtures } from '../fixtures-acquisition-hub.mjs';

export function createAcquisitionHubPublicRoutes(basePath = '/public/acquisition-hub') {
  const snapshot = buildAcquisitionHubSnapshot();
  const fixtures = createAcquisitionHubFixtures();
  return [
    { id: 'acquisition-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

