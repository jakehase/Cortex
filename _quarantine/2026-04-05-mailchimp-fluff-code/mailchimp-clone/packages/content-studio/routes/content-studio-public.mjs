import { buildContentStudioSnapshot } from '../service-content-studio.mjs';
import { createContentStudioFixtures } from '../fixtures-content-studio.mjs';

export function createContentStudioPublicRoutes(basePath = '/public/content-studio') {
  const snapshot = buildContentStudioSnapshot();
  const fixtures = createContentStudioFixtures();
  return [
    { id: 'content-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

