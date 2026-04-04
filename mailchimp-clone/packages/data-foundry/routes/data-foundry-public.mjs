import { buildDataFoundrySnapshot } from '../service-data-foundry.mjs';
import { createDataFoundryFixtures } from '../fixtures-data-foundry.mjs';

export function createDataFoundryPublicRoutes(basePath = '/public/data-foundry') {
  const snapshot = buildDataFoundrySnapshot();
  const fixtures = createDataFoundryFixtures();
  return [
    { id: 'data-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

