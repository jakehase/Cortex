import { buildActivationAtlasSnapshot } from '../service-activation-atlas.mjs';
import { createActivationAtlasFixtures } from '../fixtures-activation-atlas.mjs';

export function createActivationAtlasPublicRoutes(basePath = '/public/activation-atlas') {
  const snapshot = buildActivationAtlasSnapshot();
  const fixtures = createActivationAtlasFixtures();
  return [
    { id: 'activation-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

