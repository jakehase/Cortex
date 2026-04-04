import { buildAttributionNavigatorSnapshot } from '../service-attribution-navigator.mjs';
import { createAttributionNavigatorFixtures } from '../fixtures-attribution-navigator.mjs';

export function createAttributionNavigatorPublicRoutes(basePath = '/public/attribution-navigator') {
  const snapshot = buildAttributionNavigatorSnapshot();
  const fixtures = createAttributionNavigatorFixtures();
  return [
    { id: 'attribution-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

