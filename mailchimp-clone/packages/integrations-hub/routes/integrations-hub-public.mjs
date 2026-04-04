import { buildIntegrationsHubSnapshot } from '../service-integrations-hub.mjs';
import { createIntegrationsHubFixtures } from '../fixtures-integrations-hub.mjs';

export function createIntegrationsHubPublicRoutes(basePath = '/public/integrations-hub') {
  const snapshot = buildIntegrationsHubSnapshot();
  const fixtures = createIntegrationsHubFixtures();
  return [
    { id: 'integrations-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

