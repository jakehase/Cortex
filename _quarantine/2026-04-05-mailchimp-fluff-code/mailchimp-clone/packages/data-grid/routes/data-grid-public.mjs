import { buildDataGridSnapshot } from '../service-data-grid.mjs';
import { createDataGridFixtures } from '../fixtures-data-grid.mjs';

export function createDataGridPublicRoutes(basePath = '/public/data-grid') {
  const snapshot = buildDataGridSnapshot();
  const fixtures = createDataGridFixtures();
  return [
    { id: 'data-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

