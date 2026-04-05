import { buildIntegrationsWatchtowerSnapshot } from '../service-integrations-watchtower.mjs';
import { createIntegrationsWatchtowerFixtures } from '../fixtures-integrations-watchtower.mjs';

export function createIntegrationsWatchtowerPublicRoutes(basePath = '/public/integrations-watchtower') {
  const snapshot = buildIntegrationsWatchtowerSnapshot();
  const fixtures = createIntegrationsWatchtowerFixtures();
  return [
    { id: 'integrations-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

