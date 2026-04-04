import { buildCreativeHubSnapshot } from '../service-creative-hub.mjs';
import { createCreativeHubFixtures } from '../fixtures-creative-hub.mjs';

export function createCreativeHubPublicRoutes(basePath = '/public/creative-hub') {
  const snapshot = buildCreativeHubSnapshot();
  const fixtures = createCreativeHubFixtures();
  return [
    { id: 'creative-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

