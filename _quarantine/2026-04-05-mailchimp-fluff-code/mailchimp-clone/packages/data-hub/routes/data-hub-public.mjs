import { buildDataHubSnapshot } from '../service-data-hub.mjs';
import { createDataHubFixtures } from '../fixtures-data-hub.mjs';

export function createDataHubPublicRoutes(basePath = '/public/data-hub') {
  const snapshot = buildDataHubSnapshot();
  const fixtures = createDataHubFixtures();
  return [
    { id: 'data-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

