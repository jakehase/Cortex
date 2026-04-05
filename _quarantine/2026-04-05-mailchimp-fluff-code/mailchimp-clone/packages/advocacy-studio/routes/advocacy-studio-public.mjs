import { buildAdvocacyStudioSnapshot } from '../service-advocacy-studio.mjs';
import { createAdvocacyStudioFixtures } from '../fixtures-advocacy-studio.mjs';

export function createAdvocacyStudioPublicRoutes(basePath = '/public/advocacy-studio') {
  const snapshot = buildAdvocacyStudioSnapshot();
  const fixtures = createAdvocacyStudioFixtures();
  return [
    { id: 'advocacy-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

