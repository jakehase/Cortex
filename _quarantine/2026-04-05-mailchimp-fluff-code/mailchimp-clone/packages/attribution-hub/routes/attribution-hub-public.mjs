import { buildAttributionHubSnapshot } from '../service-attribution-hub.mjs';
import { createAttributionHubFixtures } from '../fixtures-attribution-hub.mjs';

export function createAttributionHubPublicRoutes(basePath = '/public/attribution-hub') {
  const snapshot = buildAttributionHubSnapshot();
  const fixtures = createAttributionHubFixtures();
  return [
    { id: 'attribution-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

