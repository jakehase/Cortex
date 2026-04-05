import { buildAcquisitionFoundrySnapshot } from '../service-acquisition-foundry.mjs';
import { createAcquisitionFoundryFixtures } from '../fixtures-acquisition-foundry.mjs';

export function createAcquisitionFoundryPublicRoutes(basePath = '/public/acquisition-foundry') {
  const snapshot = buildAcquisitionFoundrySnapshot();
  const fixtures = createAcquisitionFoundryFixtures();
  return [
    { id: 'acquisition-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

