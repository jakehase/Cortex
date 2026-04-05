import { buildAcquisitionStudioSnapshot } from '../service-acquisition-studio.mjs';
import { createAcquisitionStudioFixtures } from '../fixtures-acquisition-studio.mjs';

export function createAcquisitionStudioPublicRoutes(basePath = '/public/acquisition-studio') {
  const snapshot = buildAcquisitionStudioSnapshot();
  const fixtures = createAcquisitionStudioFixtures();
  return [
    { id: 'acquisition-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

