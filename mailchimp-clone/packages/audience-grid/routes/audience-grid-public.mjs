import { buildAudienceGridSnapshot } from '../service-audience-grid.mjs';
import { createAudienceGridFixtures } from '../fixtures-audience-grid.mjs';

export function createAudienceGridPublicRoutes(basePath = '/public/audience-grid') {
  const snapshot = buildAudienceGridSnapshot();
  const fixtures = createAudienceGridFixtures();
  return [
    { id: 'audience-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

