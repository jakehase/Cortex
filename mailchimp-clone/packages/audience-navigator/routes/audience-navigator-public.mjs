import { buildAudienceNavigatorSnapshot } from '../service-audience-navigator.mjs';
import { createAudienceNavigatorFixtures } from '../fixtures-audience-navigator.mjs';

export function createAudienceNavigatorPublicRoutes(basePath = '/public/audience-navigator') {
  const snapshot = buildAudienceNavigatorSnapshot();
  const fixtures = createAudienceNavigatorFixtures();
  return [
    { id: 'audience-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

