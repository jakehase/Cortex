import { buildAudienceConsoleSnapshot } from '../service-audience-console.mjs';
import { createAudienceConsoleFixtures } from '../fixtures-audience-console.mjs';

export function createAudienceConsolePublicRoutes(basePath = '/public/audience-console') {
  const snapshot = buildAudienceConsoleSnapshot();
  const fixtures = createAudienceConsoleFixtures();
  return [
    { id: 'audience-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

