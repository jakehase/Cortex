import { buildAttributionIndexSnapshot } from '../service-attribution-index.mjs';
import { createAttributionIndexFixtures } from '../fixtures-attribution-index.mjs';

export function createAttributionIndexPublicRoutes(basePath = '/public/attribution-index') {
  const snapshot = buildAttributionIndexSnapshot();
  const fixtures = createAttributionIndexFixtures();
  return [
    { id: 'attribution-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

