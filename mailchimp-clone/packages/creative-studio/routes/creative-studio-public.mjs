import { buildCreativeStudioSnapshot } from '../service-creative-studio.mjs';
import { createCreativeStudioFixtures } from '../fixtures-creative-studio.mjs';

export function createCreativeStudioPublicRoutes(basePath = '/public/creative-studio') {
  const snapshot = buildCreativeStudioSnapshot();
  const fixtures = createCreativeStudioFixtures();
  return [
    { id: 'creative-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

