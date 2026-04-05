import { buildContentHubSnapshot } from '../service-content-hub.mjs';
import { createContentHubFixtures } from '../fixtures-content-hub.mjs';

export function createContentHubPublicRoutes(basePath = '/public/content-hub') {
  const snapshot = buildContentHubSnapshot();
  const fixtures = createContentHubFixtures();
  return [
    { id: 'content-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

