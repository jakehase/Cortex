import { buildIntegrationsConsoleSnapshot } from '../service-integrations-console.mjs';
import { createIntegrationsConsoleFixtures } from '../fixtures-integrations-console.mjs';

export function createIntegrationsConsolePublicRoutes(basePath = '/public/integrations-console') {
  const snapshot = buildIntegrationsConsoleSnapshot();
  const fixtures = createIntegrationsConsoleFixtures();
  return [
    { id: 'integrations-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

