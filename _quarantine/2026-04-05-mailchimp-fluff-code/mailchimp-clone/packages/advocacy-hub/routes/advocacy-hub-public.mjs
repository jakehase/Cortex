import { buildAdvocacyHubSnapshot } from '../service-advocacy-hub.mjs';
import { createAdvocacyHubFixtures } from '../fixtures-advocacy-hub.mjs';

export function createAdvocacyHubPublicRoutes(basePath = '/public/advocacy-hub') {
  const snapshot = buildAdvocacyHubSnapshot();
  const fixtures = createAdvocacyHubFixtures();
  return [
    { id: 'advocacy-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

