import { buildAudienceHubSnapshot } from '../service-audience-hub.mjs';
import { createAudienceHubFixtures } from '../fixtures-audience-hub.mjs';

export function createAudienceHubPublicRoutes(basePath = '/public/audience-hub') {
  const snapshot = buildAudienceHubSnapshot();
  const fixtures = createAudienceHubFixtures();
  return [
    { id: 'audience-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

