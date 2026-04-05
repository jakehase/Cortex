import { buildIntegrationsAtlasSnapshot } from '../service-integrations-atlas.mjs';
import { createIntegrationsAtlasFixtures } from '../fixtures-integrations-atlas.mjs';

export function createIntegrationsAtlasPublicRoutes(basePath = '/public/integrations-atlas') {
  const snapshot = buildIntegrationsAtlasSnapshot();
  const fixtures = createIntegrationsAtlasFixtures();
  return [
    { id: 'integrations-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

