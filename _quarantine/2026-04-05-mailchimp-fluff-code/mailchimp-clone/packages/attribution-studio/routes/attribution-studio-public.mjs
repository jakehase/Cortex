import { buildAttributionStudioSnapshot } from '../service-attribution-studio.mjs';
import { createAttributionStudioFixtures } from '../fixtures-attribution-studio.mjs';

export function createAttributionStudioPublicRoutes(basePath = '/public/attribution-studio') {
  const snapshot = buildAttributionStudioSnapshot();
  const fixtures = createAttributionStudioFixtures();
  return [
    { id: 'attribution-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

