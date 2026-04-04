import { buildIntegrationsIndexSnapshot } from '../service-integrations-index.mjs';
import { createIntegrationsIndexFixtures } from '../fixtures-integrations-index.mjs';

export function createIntegrationsIndexPublicRoutes(basePath = '/public/integrations-index') {
  const snapshot = buildIntegrationsIndexSnapshot();
  const fixtures = createIntegrationsIndexFixtures();
  return [
    { id: 'integrations-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

