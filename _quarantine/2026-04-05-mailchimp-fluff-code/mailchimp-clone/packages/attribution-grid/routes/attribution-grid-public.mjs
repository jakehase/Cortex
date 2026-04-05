import { buildAttributionGridSnapshot } from '../service-attribution-grid.mjs';
import { createAttributionGridFixtures } from '../fixtures-attribution-grid.mjs';

export function createAttributionGridPublicRoutes(basePath = '/public/attribution-grid') {
  const snapshot = buildAttributionGridSnapshot();
  const fixtures = createAttributionGridFixtures();
  return [
    { id: 'attribution-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

