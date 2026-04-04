import { buildIntegrationsStudioSnapshot } from '../service-integrations-studio.mjs';
import { createIntegrationsStudioFixtures } from '../fixtures-integrations-studio.mjs';

export function createIntegrationsStudioPublicRoutes(basePath = '/public/integrations-studio') {
  const snapshot = buildIntegrationsStudioSnapshot();
  const fixtures = createIntegrationsStudioFixtures();
  return [
    { id: 'integrations-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

