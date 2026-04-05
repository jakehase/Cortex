import { buildDataStudioSnapshot } from '../service-data-studio.mjs';
import { createDataStudioFixtures } from '../fixtures-data-studio.mjs';

export function createDataStudioPublicRoutes(basePath = '/public/data-studio') {
  const snapshot = buildDataStudioSnapshot();
  const fixtures = createDataStudioFixtures();
  return [
    { id: 'data-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

