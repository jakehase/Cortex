import { buildDataCockpitSnapshot } from '../service-data-cockpit.mjs';
import { createDataCockpitFixtures } from '../fixtures-data-cockpit.mjs';

export function createDataCockpitPublicRoutes(basePath = '/public/data-cockpit') {
  const snapshot = buildDataCockpitSnapshot();
  const fixtures = createDataCockpitFixtures();
  return [
    { id: 'data-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

