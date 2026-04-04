import { buildAcquisitionCockpitSnapshot } from '../service-acquisition-cockpit.mjs';
import { createAcquisitionCockpitFixtures } from '../fixtures-acquisition-cockpit.mjs';

export function createAcquisitionCockpitPublicRoutes(basePath = '/public/acquisition-cockpit') {
  const snapshot = buildAcquisitionCockpitSnapshot();
  const fixtures = createAcquisitionCockpitFixtures();
  return [
    { id: 'acquisition-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

