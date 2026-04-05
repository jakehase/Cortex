import { buildAudienceStudioSnapshot } from '../service-audience-studio.mjs';
import { createAudienceStudioFixtures } from '../fixtures-audience-studio.mjs';

export function createAudienceStudioPublicRoutes(basePath = '/public/audience-studio') {
  const snapshot = buildAudienceStudioSnapshot();
  const fixtures = createAudienceStudioFixtures();
  return [
    { id: 'audience-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

