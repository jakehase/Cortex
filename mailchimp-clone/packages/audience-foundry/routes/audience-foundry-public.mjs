import { buildAudienceFoundrySnapshot } from '../service-audience-foundry.mjs';
import { createAudienceFoundryFixtures } from '../fixtures-audience-foundry.mjs';

export function createAudienceFoundryPublicRoutes(basePath = '/public/audience-foundry') {
  const snapshot = buildAudienceFoundrySnapshot();
  const fixtures = createAudienceFoundryFixtures();
  return [
    { id: 'audience-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

